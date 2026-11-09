import type { Prisma } from "#generated/prisma/client.js"
import { db, isUniqueViolation } from "#core/db.js"
import { BadRequestError, ConflictError, NotFoundError } from "#http/errors.js"
import { grantsSelect, roleKeys, toGrantRows } from "#security/permission-table.js"
import { loadRoleNodes, managedRoleIds, rolesBelow, ungrantableChanges, type Manager } from "./roles.access.js"
import { NotGrantableError, OutsideBranchError, ParentChangeError, SystemRoleError } from "./roles.errors.js"
import type { CreateRoleBody, UpdateRoleBody } from "./roles.schema.js"

// Who may change which role, and which permissions they may give: roles.access.ts.

const withGrants = { permissions: grantsSelect } satisfies Prisma.RoleInclude

type RoleRow = Prisma.RoleGetPayload<{ include: typeof withGrants }>

const toRole = ({ permissions, ...role }: RoleRow, managed: ReadonlySet<string>) => ({
  ...role,
  permissions: roleKeys({ isSystem: role.isSystem, permissions }),
  canManage: managed.has(role.id),
})

const managedBy = async (manager: Manager) => managedRoleIds(manager, await loadRoleNodes())

export async function listRoles(manager: Manager) {
  const [roles, managed] = await Promise.all([db.role.findMany({ include: withGrants, orderBy: { name: "asc" } }), managedBy(manager)])
  return roles.map((role) => toRole(role, managed))
}

export async function getRole(id: string, manager: Manager) {
  const role = await db.role.findUnique({ where: { id }, include: withGrants })
  if (!role) throw new NotFoundError("Role", id)
  return toRole(role, await managedBy(manager))
}

export async function createRole({ permissions, parentRoleId, ...data }: CreateRoleBody, manager: Manager) {
  const parent = parentRoleId ?? manager.roleId
  const nodes = await loadRoleNodes()
  const managed = managedRoleIds(manager, nodes)
  if (!nodes.some((node) => node.id === parent)) throw new BadRequestError("The selected managing role does not exist")
  // The Super Admin can put a role anywhere (also directly under Super Admin); an admin under their own role or below.
  if (!manager.isSuperAdmin && parent !== manager.roleId && !managed.has(parent)) throw new OutsideBranchError()
  const refused = ungrantableChanges(manager, [], permissions)
  if (refused.length > 0) throw new NotGrantableError(refused)

  const role = await db.role
    .create({
      data: { ...data, parentRoleId: parent, createdBy: manager.id, permissions: { create: await toGrantRows(permissions) } },
      include: withGrants,
    })
    .catch(toRoleWriteError)
  return toRole(role, new Set([...managed, role.id]))
}

export async function updateRole(id: string, { permissions, parentRoleId, ...changes }: UpdateRoleBody, manager: Manager) {
  const current = await db.role.findUnique({ where: { id }, include: withGrants })
  if (!current) throw new NotFoundError("Role", id)
  if (current.isSystem) throw new SystemRoleError()
  const nodes = await loadRoleNodes()
  const managed = managedRoleIds(manager, nodes)
  if (!managed.has(id)) throw new OutsideBranchError()

  if (parentRoleId !== undefined && parentRoleId !== current.parentRoleId) {
    if (!manager.isSuperAdmin) throw new ParentChangeError()
    if (!nodes.some((node) => node.id === parentRoleId)) throw new BadRequestError("The selected managing role does not exist")
    if (parentRoleId === id || rolesBelow(id, nodes).has(parentRoleId)) {
      throw new ParentChangeError("A role can't be moved under itself or a role below it")
    }
  }
  if (permissions) {
    const refused = ungrantableChanges(manager, roleKeys(current), permissions)
    if (refused.length > 0) throw new NotGrantableError(refused)
  }

  const role = await db.role
    .update({
      where: { id },
      data: {
        ...changes,
        parentRoleId,
        modifiedBy: manager.id,
        modifiedAt: new Date(),
        permissions: permissions === undefined ? undefined : { deleteMany: {}, create: await toGrantRows(permissions) },
      },
      include: withGrants,
    })
    .catch(toRoleWriteError)
  return toRole(role, managed)
}

function toRoleWriteError(err: unknown): never {
  if (isUniqueViolation(err)) throw new ConflictError("A role with this name already exists")
  throw err
}
