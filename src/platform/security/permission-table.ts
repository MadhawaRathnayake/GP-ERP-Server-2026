import { db } from "#core/db.js"
import { PERMISSION_DEFINITIONS, isPermissionKey, toPermissionKey, type PermissionKey } from "./permissions.js"

// The Permission table and the roles' grants that point at it (RolePermission).

/** Prisma `select` for a role's grants: `include: { permissions: grantsSelect }`. */
export const grantsSelect = { select: { permission: { select: { screenCode: true, permissionCode: true } } } } as const

type Grants = { permission: { screenCode: string; permissionCode: string } }[]

/** Grants → permission keys. Rows for permissions no longer defined in code are ignored. */
export const grantKeys = (grants: Grants): PermissionKey[] => grants.map((g) => toPermissionKey(g.permission)).filter(isPermissionKey)

/** Permission keys → rows to create in RolePermission. `createdBy` null = the system (seed). */
export async function toGrantRows(keys: PermissionKey[], createdBy: string | null = null): Promise<{ permissionId: number; createdBy: string | null }[]> {
  if (keys.length === 0) return []
  const rows = await db.permission.findMany({
    where: { OR: keys.map((key) => toScreenAndCode(key)) },
    select: { id: true },
  })
  // syncPermissions() runs at boot, so a missing row is a bug, not bad input.
  if (rows.length !== keys.length) throw new Error(`Permission rows missing for some of: ${keys.join(", ")}`)
  return rows.map(({ id }) => ({ permissionId: id, createdBy }))
}

/** Creates rows for permissions added in code and refreshes changed descriptions. Runs at boot. */
export async function syncPermissions() {
  const existing = new Map((await db.permission.findMany()).map((row) => [toPermissionKey(row), row]))
  const missing = PERMISSION_DEFINITIONS.filter((p) => !existing.has(p.key))
  const changed = PERMISSION_DEFINITIONS.filter((p) => {
    const row = existing.get(p.key)
    return row !== undefined && row.description !== p.description
  })

  if (missing.length > 0) {
    await db.permission.createMany({
      data: missing.map(({ screenCode, permissionCode, description }) => ({ screenCode, permissionCode, description })),
      skipDuplicates: true, // another instance may be syncing at the same time
    })
  }
  for (const { screenCode, permissionCode, description } of changed) {
    await db.permission.update({ where: { screenCode_permissionCode: { screenCode, permissionCode } }, data: { description, modifiedAt: new Date() } })
  }

  const obsolete = [...existing.keys()].filter((key) => !isPermissionKey(key))
  return { created: missing.map((p) => p.key), updated: changed.map((p) => p.key), obsolete }
}

function toScreenAndCode(key: PermissionKey) {
  const [screenCode, permissionCode] = key.split(".") as [string, string]
  return { screenCode, permissionCode }
}
