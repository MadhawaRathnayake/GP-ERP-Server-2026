import { describe, expect, it } from "vitest"
import { canGrant, managedRoleIds, rolesBelow, ungrantableChanges, type RoleNode } from "./roles.access.js"

// Super Admin → Sales Admin → Sales Supervisor → Sales Team; Accountant directly under Super Admin.
const roles: RoleNode[] = [
  { id: "SUPER", parentRoleId: null, isSystem: true },
  { id: "SALES_ADMIN", parentRoleId: "SUPER", isSystem: false },
  { id: "SUPERVISOR", parentRoleId: "SALES_ADMIN", isSystem: false },
  { id: "TEAM", parentRoleId: "SUPERVISOR", isSystem: false },
  { id: "ACCOUNTANT", parentRoleId: "SUPER", isSystem: false },
]

describe("rolesBelow / managedRoleIds", () => {
  it("reaches the whole branch, not the role itself or its siblings", () => {
    expect([...rolesBelow("SALES_ADMIN", roles)].sort()).toEqual(["SUPERVISOR", "TEAM"])
    expect(managedRoleIds({ roleId: "SUPERVISOR", isSuperAdmin: false }, roles)).toEqual(new Set(["TEAM"]))
    expect(managedRoleIds({ roleId: "TEAM", isSuperAdmin: false }, roles).size).toBe(0)
  })

  it("gives the Super Admin every role but the system role", () => {
    expect([...managedRoleIds({ roleId: "SUPER", isSuperAdmin: true }, roles)].sort()).toEqual([
      "ACCOUNTANT",
      "SALES_ADMIN",
      "SUPERVISOR",
      "TEAM",
    ])
  })
})

describe("canGrant / ungrantableChanges", () => {
  const admin = { isSuperAdmin: false, permissions: ["INVOICES.VIEW", "DROPDOWNS.VIEW"] as const }

  it("lets an admin give only their own permissions, never the Super-Admin-only ones", () => {
    expect(canGrant(admin, "INVOICES.VIEW")).toBe(true)
    expect(canGrant(admin, "INVOICES.FINALIZE")).toBe(false)
    expect(canGrant(admin, "DROPDOWNS.VIEW")).toBe(false)
    expect(canGrant({ isSuperAdmin: true, permissions: [] }, "SETTINGS.EDIT")).toBe(true)
  })

  it("checks only what changes", () => {
    // INVOICES.FINALIZE was already there and stays, so it isn't checked.
    expect(ungrantableChanges(admin, ["INVOICES.FINALIZE"], ["INVOICES.FINALIZE", "INVOICES.VIEW"])).toEqual([])
    expect(ungrantableChanges(admin, ["INVOICES.FINALIZE"], [])).toEqual(["INVOICES.FINALIZE"])
    expect(ungrantableChanges(admin, [], ["SETTINGS.VIEW"])).toEqual(["SETTINGS.VIEW"])
  })
})
