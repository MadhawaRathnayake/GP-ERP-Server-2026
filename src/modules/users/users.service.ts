import type { Prisma } from "#generated/prisma/client.js"
import { db, isForeignKeyViolation, isUniqueViolation } from "#core/db.js"
import { BadRequestError, ConflictError, NotFoundError } from "#http/errors.js"
import { hashPassword } from "#security/password.js"
import { sessions } from "#security/sessions.js"
import { loadRoleNodes, managedRoleIds, type Manager } from "#modules/roles/roles.access.js"
import { OutsideBranchError, SystemRoleError } from "#modules/roles/roles.errors.js"
import { OwnAccountError, SuperAdminUserError } from "./users.errors.js"
import type { CreateUserBody, ListUsersQuery, UpdateUserBody } from "./users.schema.js"

// An admin creates, edits and deactivates the users in the roles below their own role (modules/roles/roles.access.ts);
// nobody gives a user the Super Admin role. Every user can change their own name, email and password, but not their
// own role or status: so nobody can promote, lock out or deactivate themselves, and the one Super Admin's account
// can only be changed by the Super Admin (or recovered with `npm run admin:restore`).

const withRole = { role: { select: { name: true, isSystem: true } } } satisfies Prisma.UserInclude

// GetPayload doesn't know about the global `omit` in platform/core/db.ts, so drop passwordHash here to match what queries return.
type UserRow = Omit<Prisma.UserGetPayload<{ include: typeof withRole }>, "passwordHash">

const toUser = ({ role, ...user }: UserRow, managed: ReadonlySet<string>) => ({
  ...user,
  roleName: role.name,
  canManage: managed.has(user.roleId),
})

const managedBy = async (manager: Manager) => managedRoleIds(manager, await loadRoleNodes())

export async function listUsers({ includeDeleted }: ListUsersQuery, manager: Manager) {
  const [users, managed] = await Promise.all([
    db.user.findMany({ where: includeDeleted ? {} : { isDeleted: false }, include: withRole, orderBy: { createdAt: "desc" } }),
    managedBy(manager),
  ])
  return users.map((user) => toUser(user, managed))
}

export async function getUser(id: string, manager: Manager) {
  return toUser(await findUser(id), await managedBy(manager))
}

export async function createUser({ password, ...data }: CreateUserBody, manager: Manager) {
  const managed = await managedBy(manager)
  await assertAssignable(data.roleId, managed)
  const user = await db.user
    .create({
      data: { ...data, passwordHash: await hashPassword(password), createdBy: manager.id },
      include: withRole,
    })
    .catch(toUserWriteError)
  return toUser(user, managed)
}

export async function updateUser(id: string, { password, ...changes }: UpdateUserBody, manager: Manager) {
  const target = await findUser(id)
  const managed = await managedBy(manager)
  const changesAccess = changes.roleId !== undefined || changes.isDeleted !== undefined
  if (id === manager.id) {
    if (changesAccess) throw new OwnAccountError()
  } else if (target.role.isSystem) {
    throw new SuperAdminUserError()
  } else if (!managed.has(target.roleId)) {
    throw new OutsideBranchError("You can only manage the users in the roles under your own role")
  }
  if (changes.roleId !== undefined && changes.roleId !== target.roleId) await assertAssignable(changes.roleId, managed)

  const user = await db.user
    .update({
      where: { id },
      data: {
        ...changes,
        passwordHash: password === undefined ? undefined : await hashPassword(password),
        modifiedBy: manager.id,
        modifiedAt: new Date(),
      },
      include: withRole,
    })
    .catch(toUserWriteError)

  if (changes.isDeleted === true) {
    await sessions.destroyAllForUser(id)
  } else if (password !== undefined) {
    // A replaced password ends the user's other sessions; a user changing their own keeps the current one.
    await sessions.destroyAllForUser(id, { except: manager.sessionId })
  }
  return toUser(user, managed)
}

/** Users are never deleted: they're deactivated, keeping their history and the createdBy/modifiedBy references. */
export async function deactivateUser(id: string, manager: Manager): Promise<void> {
  await updateUser(id, { isDeleted: true }, manager)
}

/** Reserves the next USER00001-style id. Only needed for the very first user, who is their own creator (seed, tests). */
export async function reserveUserId(): Promise<string> {
  const [row] = await db.$queryRaw<[{ id: string }]>`SELECT next_user_id() AS id`
  return row.id
}

async function findUser(id: string): Promise<UserRow> {
  const user = await db.user.findUnique({ where: { id }, include: withRole })
  if (!user) throw new NotFoundError("User", id)
  return user
}

/** A user can be put in a role the manager manages, never in the system role. */
async function assertAssignable(roleId: string, managed: ReadonlySet<string>) {
  const role = await db.role.findUnique({ where: { id: roleId }, select: { isSystem: true } })
  if (!role) throw new BadRequestError("The selected role does not exist")
  if (role.isSystem) throw new SystemRoleError()
  if (!managed.has(roleId)) throw new OutsideBranchError("You can only give users the roles under your own role")
}

function toUserWriteError(err: unknown): never {
  if (isUniqueViolation(err)) throw new ConflictError("A user with this email already exists")
  if (isForeignKeyViolation(err)) throw new BadRequestError("The selected role does not exist")
  throw err
}
