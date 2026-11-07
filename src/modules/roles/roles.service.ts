import type { Prisma } from "#generated/prisma/client.js"
import { db, isUniqueViolation } from "#core/db.js"
import { ConflictError, NotFoundError } from "#http/errors.js"
import { USER_ADMIN_PERMISSION } from "#security/permissions.js"
import type { Actor } from "#security/auth.plugin.js"
import type { CurrentUser } from "#security/current-user.js"
import { grantsSelect, roleKeys, toGrantRows } from "#security/permission-table.js"
import { SelfLockoutError } from "#modules/users/users.errors.js"
import { SystemRoleError } from "./roles.errors.js"
import type { CreateRoleBody, UpdateRoleBody } from "./roles.schema.js"

const withGrants = { permissions: grantsSelect } satisfies Prisma.RoleInclude

type RoleRow = Prisma.RoleGetPayload<{ include: typeof withGrants }>

const toRole = ({ permissions, ...role }: RoleRow) => ({ ...role, permissions: roleKeys({ isSystem: role.isSystem, permissions }) })

export async function listRoles() {
  const roles = await db.role.findMany({ include: withGrants, orderBy: { name: "asc" } })
  return roles.map(toRole)
}

export async function getRole(id: string) {
  const role = await db.role.findUnique({ where: { id }, include: withGrants })
  if (!role) throw new NotFoundError("Role", id)
  return toRole(role)
}

export async function createRole({ permissions, ...data }: CreateRoleBody, actor: Actor) {
  const role = await db.role
    .create({
      data: { ...data, createdBy: actor.id, permissions: { create: await toGrantRows(permissions) } },
      include: withGrants,
    })
    .catch(toRoleWriteError)
  return toRole(role)
}

export async function updateRole(id: string, { permissions, ...changes }: UpdateRoleBody, actor: Pick<CurrentUser, "id" | "roleId">) {
  // Only the description and branch code of a system role can change. An unknown id falls through to the update's 404.
  const current = await db.role.findUnique({ where: { id }, select: { isSystem: true } })
  if (current?.isSystem && (permissions !== undefined || changes.name !== undefined)) throw new SystemRoleError()

  if (id === actor.roleId && permissions && !permissions.includes(USER_ADMIN_PERMISSION)) {
    throw new SelfLockoutError("You can't remove the user-management permission from your own role")
  }

  const role = await db.role
    .update({
      where: { id },
      data: {
        ...changes,
        modifiedBy: actor.id,
        modifiedAt: new Date(),
        permissions: permissions === undefined ? undefined : { deleteMany: {}, create: await toGrantRows(permissions) },
      },
      include: withGrants,
    })
    .catch(toRoleWriteError)
  return toRole(role)
}

function toRoleWriteError(err: unknown): never {
  if (isUniqueViolation(err)) throw new ConflictError("A role with this name already exists")
  throw err
}
