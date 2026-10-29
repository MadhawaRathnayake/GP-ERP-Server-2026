import { describe, expect, it } from "vitest"
import { createRoleBody, updateRoleBody } from "./roles.schema.js"

describe("role bodies", () => {
  it("fills defaults on create", () => {
    expect(createRoleBody.parse({ name: "Clerk" })).toEqual({ name: "Clerk", description: "", permissions: [] })
  })

  it("leaves fields that a PATCH doesn't send untouched", () => {
    expect(updateRoleBody.parse({ description: "Front desk" })).toEqual({ description: "Front desk" })
  })
})
