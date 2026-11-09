import { z } from "zod"
import { permissionKeySchema, permissionKeysInput } from "#security/permissions.js"

const roleId = z.string().regex(/^ROLE\d{4,}$/, "Must be a role id like ROLE0001")

export const roleIdParams = z.object({ id: roleId })

export const role = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  isSystem: z.boolean().describe("true = Super Admin: has every permission; can't be changed or given to users"),
  parentRoleId: z.string().nullable().describe("The managing role: its admins manage this role. null only on the Super Admin role"),
  branchCode: z.string().describe("The middle part of the invoice numbers its users make, e.g. GP01 in 26NOV_GP01_14"),
  permissions: z.array(permissionKeySchema),
  createdBy: z.string().nullable(),
  createdAt: z.date(),
  modifiedBy: z.string().nullable(),
  modifiedAt: z.date().nullable(),
  isDeleted: z.boolean(),
  canManage: z.boolean().describe("Whether the signed-in user may edit this role (it's below their own role)"),
})

export const roleList = z.array(role)

const name = z.string().trim().min(1).max(60)
const description = z.string().trim().max(500)
const branchCode = z
  .string()
  .trim()
  .regex(/^[A-Z0-9]{1,10}$/, "Must be 1 to 10 capital letters or digits, e.g. GP01")
  .describe("The middle part of the invoice numbers its users make, e.g. GP01 in 26NOV_GP01_14")

const parentRoleId = roleId.describe(
  "The managing role. Default: your own role. An admin can pick their own role or one below it; only the Super Admin can move a role later",
)

export const createRoleBody = z.object({
  parentRoleId: parentRoleId.optional(),
  name,
  description: description.default(""),
  branchCode,
  permissions: permissionKeysInput.default([]),
})

// Built without defaults: `createRoleBody.partial()` would keep them, so a PATCH that leaves out `permissions`
// would reset them to [].
export const updateRoleBody = z.object({ parentRoleId, name, description, branchCode, permissions: permissionKeysInput }).partial()

export type CreateRoleBody = z.infer<typeof createRoleBody>
export type UpdateRoleBody = z.infer<typeof updateRoleBody>
