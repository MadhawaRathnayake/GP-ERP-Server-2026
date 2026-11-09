import type { FastifyRequest } from "fastify"
import { db } from "#core/db.js"
import { actorOf, type Actor } from "#security/auth.plugin.js"
import { isSuperAdminOnly, type PermissionKey } from "#security/permissions.js"

// Who manages which roles and users. There is one Super Admin (the system role) at the top; every other role has a
// managing role above it (Role.parentRoleId). An admin manages the roles below their own role, at any depth (their
// branch), and the users in those roles: never their own role, a role above or beside it, or the Super Admin. The
// Super Admin manages every role and user but itself. Everyone can see every role and user (with ROLES.VIEW /
// USERS.VIEW); `canManage` in the responses says which ones the signed-in user may change.

/** The acting user, with what the rules need. Build it with managerOf(req). */
export interface Manager extends Actor {
  roleId: string
  isSuperAdmin: boolean
  permissions: readonly PermissionKey[]
}

export const managerOf = (req: FastifyRequest): Manager => ({
  ...actorOf(req),
  roleId: req.user.roleId,
  isSuperAdmin: req.user.isSuperAdmin,
  permissions: req.user.permissions,
})

export interface RoleNode {
  id: string
  parentRoleId: string | null
  isSystem: boolean
}

/** The ids of every role below `roleId`, at any depth. */
export function rolesBelow(roleId: string, roles: readonly RoleNode[]): Set<string> {
  const below = new Set<string>()
  let level = [roleId]
  while (level.length > 0) {
    const next = roles.filter((role) => role.parentRoleId !== null && level.includes(role.parentRoleId) && !below.has(role.id))
    for (const role of next) below.add(role.id)
    level = next.map((role) => role.id)
  }
  return below
}

/** The roles the manager manages: every role but the system role for the Super Admin, else the roles below their own. */
export function managedRoleIds(manager: Pick<Manager, "roleId" | "isSuperAdmin">, roles: readonly RoleNode[]): Set<string> {
  if (manager.isSuperAdmin) return new Set(roles.filter((role) => !role.isSystem).map((role) => role.id))
  return rolesBelow(manager.roleId, roles)
}

export function loadRoleNodes(): Promise<RoleNode[]> {
  return db.role.findMany({ select: { id: true, parentRoleId: true, isSystem: true } })
}

/**
 * Whether the manager may add `key` to a role they manage, or take it away: the Super Admin any permission; an admin
 * only one their own role has, and never a Super-Admin-only one (Settings, Dropdowns, Approvals).
 */
export function canGrant(manager: Pick<Manager, "isSuperAdmin" | "permissions">, key: PermissionKey): boolean {
  return manager.isSuperAdmin || (!isSuperAdminOnly(key) && manager.permissions.includes(key))
}

/** The permissions that differ between `before` and `after` and that the manager may not change. */
export function ungrantableChanges(
  manager: Pick<Manager, "isSuperAdmin" | "permissions">,
  before: readonly PermissionKey[],
  after: readonly PermissionKey[],
): PermissionKey[] {
  const added = after.filter((key) => !before.includes(key))
  const removed = before.filter((key) => !after.includes(key))
  return [...added, ...removed].filter((key) => !canGrant(manager, key))
}
