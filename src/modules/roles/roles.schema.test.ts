import { describe, expect, it } from "vitest"
import { createRoleBody, roleIdParams, updateRoleBody } from "./roles.schema.js"

describe("role bodies", () => {
  it("fills defaults on create", () => {
    expect(createRoleBody.parse({ name: "Clerk", branchCode: "GP01" })).toEqual({ name: "Clerk", description: "", branchCode: "GP01", permissions: [] })
  })

  it("needs a branch code of capital letters and digits", () => {
    expect(createRoleBody.safeParse({ name: "Clerk" }).success).toBe(false)
    expect(createRoleBody.safeParse({ name: "Clerk", branchCode: "gp-01" }).success).toBe(false)
  })

  it("leaves fields that a PATCH doesn't send untouched", () => {
    expect(updateRoleBody.parse({ description: "Front desk" })).toEqual({ description: "Front desk" })
  })
})

describe("role id", () => {
  it.each(["ROLE0001", "ROLE12345"])("accepts %s", (id) => {
    expect(roleIdParams.safeParse({ id }).success).toBe(true)
  })

  it.each(["ROLE001", "role0001", "00000000-0000-4000-8000-000000000000"])("rejects %s", (id) => {
    expect(roleIdParams.safeParse({ id }).success).toBe(false)
  })
})
