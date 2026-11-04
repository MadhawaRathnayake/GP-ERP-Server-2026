import { z } from "zod"
import { USER_DROPDOWN_CODES } from "./dropdowns.js"

const userId = z.string().regex(/^USER\d{5,}$/, "Must be a user id like USER00001")
const roleId = z.string().regex(/^ROLE\d{4,}$/, "Must be a role id like ROLE0001")

export const userDropdownCode = z.enum(USER_DROPDOWN_CODES)

export const dropdownCodeParams = z.object({ code: userDropdownCode })

export const userDropdownSource = z
  .enum(["users", "roles"])
  .describe("users = the users in userIds; roles = every active user whose role is in roleIds")

export const userDropdown = z.object({
  code: userDropdownCode,
  label: z.string(),
  source: userDropdownSource,
  userIds: z.array(z.string()),
  roleIds: z.array(z.string()),
})

export const userDropdownList = z.array(userDropdown)

/** A user a dropdown offers. */
export const dropdownUser = z.object({ id: z.string(), name: z.string() })

export const dropdownUserList = z.array(dropdownUser)

// Duplicates are dropped.
const ids = <T extends z.ZodString>(id: T) =>
  z
    .array(id)
    .max(500)
    .transform((list) => [...new Set(list)])

export const updateUserDropdownBody = z
  .object({ source: userDropdownSource, userIds: ids(userId), roleIds: ids(roleId) })
  .partial()
  .refine((body) => Object.keys(body).length > 0, "Provide source, userIds or roleIds")

export type UpdateUserDropdownBody = z.infer<typeof updateUserDropdownBody>
