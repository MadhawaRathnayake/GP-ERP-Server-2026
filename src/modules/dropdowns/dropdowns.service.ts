import type { UserDropdown } from "#generated/prisma/client.js"
import { db } from "#core/db.js"
import { BadRequestError } from "#http/errors.js"
import type { Actor } from "#security/auth.plugin.js"
import { USER_DROPDOWN_CODES, USER_DROPDOWNS, type UserDropdownCode } from "./dropdowns.js"
import type { UpdateUserDropdownBody } from "./dropdowns.schema.js"

// A dropdown nobody has saved yet offers no one, so an admin has to choose its users before it can be used.
const notSaved = (): Pick<UserDropdown, "source" | "userIds" | "roleIds"> => ({ source: "roles", userIds: [], roleIds: [] })

const toDropdown = (code: UserDropdownCode, row: UserDropdown | undefined) => ({ code, label: USER_DROPDOWNS[code], ...(row ?? notSaved()) })

/** Every dropdown defined in dropdowns.ts, saved or not. */
export async function listUserDropdowns() {
  const rows = new Map((await db.userDropdown.findMany()).map((row) => [row.id, row]))
  return USER_DROPDOWN_CODES.map((code) => toDropdown(code, rows.get(code)))
}

export async function updateUserDropdown(code: UserDropdownCode, data: UpdateUserDropdownBody, actor: Actor) {
  if (data.userIds) await assertActiveUsers(data.userIds)
  if (data.roleIds) await assertRoles(data.roleIds)
  const row = await db.userDropdown.upsert({
    where: { id: code },
    create: { id: code, ...data, createdBy: actor.id },
    update: { ...data, modifiedBy: actor.id, modifiedAt: new Date() },
  })
  return toDropdown(code, row)
}

/** The active users a dropdown offers, by name. */
export async function dropdownUsers(code: UserDropdownCode) {
  const row = await db.userDropdown.findUnique({ where: { id: code } })
  if (!row) return []
  const picked = row.source === "users" ? { id: { in: row.userIds } } : { roleId: { in: row.roleIds } }
  return db.user.findMany({ where: { ...picked, isDeleted: false }, select: { id: true, name: true }, orderBy: { name: "asc" } })
}

/** Whether `userId` is one of the users the dropdown offers now. */
export async function isDropdownUser(code: UserDropdownCode, userId: string) {
  return (await dropdownUsers(code)).some((user) => user.id === userId)
}

async function assertActiveUsers(ids: string[]) {
  const found = await db.user.findMany({ where: { id: { in: ids }, isDeleted: false }, select: { id: true } })
  const missing = ids.filter((id) => !found.some((user) => user.id === id))
  if (missing.length > 0) throw new BadRequestError(`These users don't exist or are deactivated: ${missing.join(", ")}`)
}

async function assertRoles(ids: string[]) {
  const found = await db.role.findMany({ where: { id: { in: ids } }, select: { id: true } })
  const missing = ids.filter((id) => !found.some((role) => role.id === id))
  if (missing.length > 0) throw new BadRequestError(`These roles don't exist: ${missing.join(", ")}`)
}
