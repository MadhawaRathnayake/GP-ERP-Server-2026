import { z } from "zod"

const userId = z.string().regex(/^USER\d{5,}$/, "Must be a user id like USER00001")
const name = z.string().trim().min(1).max(100)
const email = z.string().trim().toLowerCase().pipe(z.email())
const password = z.string().min(8, "Password must be at least 8 characters").max(200)
const roleId = z.uuid().describe("The user's permissions are the permissions of this role")

export const userIdParams = z.object({ id: userId })

// Never includes the password hash (it isn't even loaded — see the global omit in platform/core/db.ts).
export const user = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  roleId: z.uuid(),
  roleName: z.string(),
  isActive: z.boolean(),
  createdAt: z.date(),
  createdBy: z.string(),
  modifiedAt: z.date().nullable(),
  modifiedBy: z.string().nullable(),
})

export const userList = z.array(user)

export const listUsersQuery = z.object({
  includeInactive: z.stringbool().default(false).describe("Include deactivated (deleted) users"),
})

// createdBy/createdAt/modifiedBy/modifiedAt are set by the server and can't be sent.
export const createUserBody = z.object({
  name,
  email,
  password,
  roleId,
})

export const updateUserBody = z
  .object({
    name,
    email,
    password: password.describe("Replaces the current password and signs the user out of their other sessions"),
    roleId,
    isActive: z.boolean().describe("false = deleted: can't sign in, hidden from lists by default"),
  })
  .partial()

export type ListUsersQuery = z.infer<typeof listUsersQuery>
export type CreateUserBody = z.infer<typeof createUserBody>
export type UpdateUserBody = z.infer<typeof updateUserBody>
