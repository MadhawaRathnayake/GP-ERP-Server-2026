import { describe, expect, it } from "vitest"
import { dropdownCodeParams, updateUserDropdownBody } from "./dropdowns.schema.js"

describe("updateUserDropdownBody", () => {
  it("drops duplicate ids", () => {
    expect(updateUserDropdownBody.parse({ userIds: ["USER00001", "USER00001"], roleIds: ["ROLE0002", "ROLE0002"] })).toEqual({
      userIds: ["USER00001"],
      roleIds: ["ROLE0002"],
    })
  })

  it.each([[{}], [{ source: "everyone" }], [{ userIds: ["ROLE0001"] }], [{ roleIds: ["USER00001"] }]])("rejects %j", (body) => {
    expect(updateUserDropdownBody.safeParse(body).success).toBe(false)
  })
})

describe("dropdownCodeParams", () => {
  it("accepts only codes defined in dropdowns.ts", () => {
    expect(dropdownCodeParams.safeParse({ code: "SALES_MANAGER" }).success).toBe(true)
    expect(dropdownCodeParams.safeParse({ code: "NOPE" }).success).toBe(false)
  })
})
