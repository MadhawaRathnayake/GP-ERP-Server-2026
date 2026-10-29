import type { Prisma } from "#generated/prisma/client.js"
import { db, isForeignKeyViolation, isUniqueViolation } from "#core/db.js"
import { BadRequestError, ConflictError, NotFoundError } from "#http/errors.js"
import { hashPassword } from "#security/password.js"
import { USER_ADMIN_PERMISSION } from "#security/permissions.js"
import { sessions } from "#security/sessions.js"
import type { Actor } from "#security/auth.plugin.js"
import { grantKeys, grantsSelect } from "#security/permission-table.js"
import { SelfLockoutError } from "./users.errors.js"
import type { CreateUserBody, ListUsersQuery, UpdateUserBody } from "./users.schema.js"

const withRole = { role: { select: { name: true } } } satisfies Prisma.UserInclude

// GetPayload doesn't know about the global `omit` in platform/core/db.ts, so drop passwordHash here to match what queries return.
type UserRow = Omit<Prisma.UserGetPayload<{ include: typeof withRole }>, "passwordHash">

const toUser = ({ role, ...user }: UserRow) => ({ ...user, roleName: role.name })

export async function listUsers({ includeInactive }: ListUsersQuery) {
  const users = await db.user.findMany({
    where: includeInactive ? {} : { isActive: true },
    include: withRole,
    orderBy: { createdAt: "desc" },
  })
  return users.map(toUser)
}

export async function getUser(id: string) {
  return toUser(await findUser(id))
}

export async function createUser({ password, ...data }: CreateUserBody, actor: Actor) {
  const user = await db.user
    .create({
      data: { ...data, passwordHash: await hashPassword(password), createdBy: actor.id },
      include: withRole,
    })
    .catch(toUserWriteError)
  return toUser(user)
}

export async function updateUser(id: string, { password, ...changes }: UpdateUserBody, actor: Actor) {
  if (id === actor.id) await assertKeepsUserAdmin(changes)

  const user = await db.user
    .update({
      where: { id },
      data: {
        ...changes,
        passwordHash: password === undefined ? undefined : await hashPassword(password),
        modifiedBy: actor.id,
        modifiedAt: new Date(),
      },
      include: withRole,
    })
    .catch(toUserWriteError)

  if (changes.isActive === false) {
    await sessions.destroyAllForUser(id)
  } else if (password !== undefined) {
    // A replaced password ends the user's other sessions; an admin changing their own keeps the current one.
    await sessions.destroyAllForUser(id, { except: actor.sessionId })
  }
  return toUser(user)
}

/** Users are never deleted: they're deactivated, keeping their history and the createdBy/modifiedBy references. */
export async function deactivateUser(id: string, actor: Actor): Promise<void> {
  await updateUser(id, { isActive: false }, actor)
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

/** Rejects a change that would deactivate the actor or move them to a role that can't manage users. */
async function assertKeepsUserAdmin(changes: Omit<UpdateUserBody, "password">) {
  if (changes.isActive === false) throw new SelfLockoutError()
  if (changes.roleId === undefined) return

  const role = await db.role.findUnique({ where: { id: changes.roleId }, select: { permissions: grantsSelect } })
  if (!role) throw new BadRequestError("The selected role does not exist")
  if (!grantKeys(role.permissions).includes(USER_ADMIN_PERMISSION)) throw new SelfLockoutError()
}

function toUserWriteError(err: unknown): never {
  if (isUniqueViolation(err)) throw new ConflictError("A user with this email already exists")
  if (isForeignKeyViolation(err)) throw new BadRequestError("The selected role does not exist")
  throw err
}
