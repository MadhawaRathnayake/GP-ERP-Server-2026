import type { Prisma, UserDropdownSource } from "#generated/prisma/client.js"
import { db } from "#core/db.js"
import { BadRequestError } from "#http/errors.js"
import type { Actor } from "#security/auth.plugin.js"
import { USER_DROPDOWN_CODES, USER_DROPDOWNS, type UserDropdownCode } from "./dropdowns.js"
import type { UpdateUserDropdownBody } from "./dropdowns.schema.js"

// A dropdown's picked users and roles are rows of UserDropdownUser / UserDropdownRole; the API shows them as id lists.
const picks = {
  users: { select: { userId: true }, orderBy: { userId: "asc" } },
  roles: { select: { roleId: true }, orderBy: { roleId: "asc" } },
} satisfies Prisma.UserDropdownInclude

type Saved = Prisma.UserDropdownGetPayload<{ include: typeof picks }>

// A dropdown nobody has saved yet offers no one, so an admin has to choose its users before it can be used.
const toDropdown = (code: UserDropdownCode, row: Saved | undefined) => ({
  code,
  label: USER_DROPDOWNS[code],
  source: row?.source ?? ("roles" satisfies UserDropdownSource),
  userIds: row?.users.map((pick) => pick.userId) ?? [],
  roleIds: row?.roles.map((pick) => pick.roleId) ?? [],
})

/** Every dropdown defined in dropdowns.ts, saved or not. */
export async function listUserDropdowns() {
  const rows = new Map((await db.userDropdown.findMany({ include: picks })).map((row) => [row.id, row]))
  return USER_DROPDOWN_CODES.map((code) => toDropdown(code, rows.get(code)))
}

/** Saves the source and replaces the lists that are given. */
export async function updateUserDropdown(code: UserDropdownCode, { source, userIds, roleIds }: UpdateUserDropdownBody, actor: Actor) {
  if (userIds) await assertActiveUsers(userIds)
  if (roleIds) await assertRoles(roleIds)
  const row = await db.$transaction(async (tx) => {
    await tx.userDropdown.upsert({
      where: { id: code },
      create: { id: code, source, createdBy: actor.id },
      update: { source, modifiedBy: actor.id, modifiedAt: new Date() },
    })
    if (userIds) {
      await tx.userDropdownUser.deleteMany({ where: { dropdownId: code } })
      await tx.userDropdownUser.createMany({ data: userIds.map((userId) => ({ dropdownId: code, userId })) })
    }
    if (roleIds) {
      await tx.userDropdownRole.deleteMany({ where: { dropdownId: code } })
      await tx.userDropdownRole.createMany({ data: roleIds.map((roleId) => ({ dropdownId: code, roleId })) })
    }
    return tx.userDropdown.findUniqueOrThrow({ where: { id: code }, include: picks })
  })
  return toDropdown(code, row)
}

/** The active users a dropdown offers, by name. */
export async function dropdownUsers(code: UserDropdownCode) {
  const row = await db.userDropdown.findUnique({ where: { id: code }, select: { source: true } })
  if (!row) return []
  const picked: Prisma.UserWhereInput =
    row.source === "users" ? { dropdowns: { some: { dropdownId: code } } } : { role: { dropdowns: { some: { dropdownId: code } } } }
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
