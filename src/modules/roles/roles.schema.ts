import { z } from "zod"
import { permissionKeySchema, permissionKeysInput } from "#security/permissions.js"

export const role = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string(),
  permissions: z.array(permissionKeySchema),
  createdBy: z.string().nullable(),
  createdAt: z.date(),
  modifiedBy: z.string().nullable(),
  modifiedAt: z.date().nullable(),
  isActive: z.boolean(),
})

export const roleList = z.array(role)

const name = z.string().trim().min(1).max(60)
const description = z.string().trim().max(500)

export const createRoleBody = z.object({
  name,
  description: description.default(""),
  permissions: permissionKeysInput.default([]),
})

// Built without defaults: `createRoleBody.partial()` would keep them, so a PATCH that leaves out `permissions`
// would reset them to [].
export const updateRoleBody = z.object({ name, description, permissions: permissionKeysInput }).partial()

export type CreateRoleBody = z.infer<typeof createRoleBody>
export type UpdateRoleBody = z.infer<typeof updateRoleBody>
