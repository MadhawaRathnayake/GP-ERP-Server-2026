import { z } from "zod"
import { cache } from "#cache/cache.js"
import { db } from "#core/db.js"
import { grantKeys, grantsSelect } from "./permission-table.js"
import { permissionKeySchema } from "./permissions.js"

/** The signed-in user, as returned by /api/v1/auth/me and available as `req.user`. */
export const currentUser = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  roleId: z.uuid(),
  roleName: z.string(),
  permissions: z.array(permissionKeySchema).describe("The permissions of the user's role. Show a screen when it has <SCREEN>.VIEW"),
})

export type CurrentUser = z.infer<typeof currentUser>

/**
 * The user behind a session, with their role's permissions; null when they're unknown or deactivated. Runs on every
 * authenticated request, so it's cached in Redis against every table it reads: deactivation, a new role or changed
 * grants apply on the user's next request.
 */
export function getCurrentUser(userId: string): Promise<CurrentUser | null> {
  const tables = ["User", "Role", "Permission", "RolePermission"]
  return cache.remember({ tables, key: `auth:user:${userId}` }, async () => {
    const user = await db.user.findUnique({
      where: { id: userId },
      include: { role: { include: { permissions: grantsSelect } } },
    })
    if (!user?.isActive) return null
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      roleId: user.roleId,
      roleName: user.role.name,
      permissions: grantKeys(user.role.permissions),
    }
  })
}
