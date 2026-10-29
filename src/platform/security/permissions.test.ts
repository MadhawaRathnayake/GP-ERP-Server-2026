import { describe, expect, it } from "vitest"
import { PERMISSION_DEFINITIONS, isPermissionKey, permissionKeysInput } from "./permissions.js"

describe("permissions", () => {
  it("builds SCREEN.PERMISSION keys from the definitions", () => {
    expect(PERMISSION_DEFINITIONS).toContainEqual({
      key: "PRODUCTS.CREATE",
      screenCode: "PRODUCTS",
      permissionCode: "CREATE",
      description: "Create products",
    })
    expect(new Set(PERMISSION_DEFINITIONS.map((p) => p.key)).size).toBe(PERMISSION_DEFINITIONS.length)
  })

  it("gives every screen a VIEW permission, which the frontend uses to show the screen", () => {
    const screens = new Set(PERMISSION_DEFINITIONS.map((p) => p.screenCode))
    for (const screen of screens) expect(isPermissionKey(`${screen}.VIEW`)).toBe(true)
  })

  it("accepts known keys only and drops duplicates", () => {
    expect(permissionKeysInput.parse(["PRODUCTS.VIEW", "PRODUCTS.VIEW"])).toEqual(["PRODUCTS.VIEW"])
    expect(permissionKeysInput.safeParse(["PRODUCTS.FLY"]).success).toBe(false)
  })
})
