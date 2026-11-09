import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { App } from "#app.js"
import { PERMISSION_DEFINITIONS } from "#security/permissions.js"
import { TEST_PREFIX, cleanupTestUsers, createTestRole, signIn, startApp, systemRoleId, type TestUser } from "#test/helpers.js"

let app: App
let superAdmin: TestUser // in the system role
let admin: TestUser // a "Sales Admin": a role directly under Super Admin
let adminRoleId: string
let systemId: string
const ADMIN = ["ROLES.VIEW", "ROLES.CREATE", "ROLES.EDIT", "DASHBOARD.VIEW", "REPORTS.VIEW", "DROPDOWNS.VIEW"] as const
const roleName = (label: string) => `${TEST_PREFIX}${label}-${Date.now()}`

beforeAll(async () => {
  app = await startApp()
  systemId = await systemRoleId()
  superAdmin = await signIn(app, { roleId: systemId })
  adminRoleId = (await createTestRole([...ADMIN])).id
  admin = await signIn(app, { roleId: adminRoleId })
})

afterAll(async () => {
  await cleanupTestUsers()
  await app.close()
})

const post = (payload: object, cookie = admin.cookie) => app.inject({ method: "POST", url: "/api/v1/roles", headers: { cookie }, payload })
const patch = (id: string, payload: object, cookie = admin.cookie) =>
  app.inject({ method: "PATCH", url: `/api/v1/roles/${id}`, headers: { cookie }, payload })
const get = (id: string, cookie = admin.cookie) => app.inject({ url: `/api/v1/roles/${id}`, headers: { cookie } })

describe("roles", () => {
  it("can be viewed with ROLES.VIEW but only created with ROLES.CREATE", async () => {
    const viewer = await signIn(app, ["ROLES.VIEW"])
    expect((await app.inject({ url: "/api/v1/roles", headers: { cookie: viewer.cookie } })).statusCode).toBe(200)
    expect((await post({ name: roleName("x"), branchCode: "GP01" }, viewer.cookie)).statusCode).toBe(403)
  })

  it("creates a role under the admin's own role, which the admin then manages", async () => {
    const name = roleName("team")
    const created = await post({ name, description: "Front desk", branchCode: "GP02", permissions: ["DASHBOARD.VIEW"] })
    expect(created.statusCode).toBe(201)
    expect(created.json()).toMatchObject({ name, parentRoleId: adminRoleId, canManage: true, permissions: ["DASHBOARD.VIEW"] })
    const { id } = created.json()

    const updated = await patch(id, { permissions: ["DASHBOARD.VIEW", "REPORTS.VIEW"] })
    expect(updated.json().permissions.sort()).toEqual(["DASHBOARD.VIEW", "REPORTS.VIEW"])
    expect((await patch(id, { description: "Reception" })).json().permissions).toHaveLength(2) // untouched when not sent
  })

  it("manages the whole branch below the admin's role, nothing else", async () => {
    const child = (await post({ name: roleName("supervisor"), branchCode: "GP01" })).json()
    const grandchild = (await post({ name: roleName("staff"), branchCode: "GP01", parentRoleId: child.id })).json()
    expect(grandchild).toMatchObject({ parentRoleId: child.id, canManage: true })
    expect((await patch(grandchild.id, { description: "Two levels down" })).statusCode).toBe(200)

    // Its own role, a role beside it and the Super Admin role are read-only for it.
    const sibling = await createTestRole([])
    expect((await get(adminRoleId)).json().canManage).toBe(false)
    for (const id of [adminRoleId, sibling.id]) expect((await patch(id, { description: "x" })).json().error.code).toBe("OUTSIDE_BRANCH")
    expect((await patch(systemId, { description: "x" })).json().error.code).toBe("SYSTEM_ROLE")
    const elsewhere = await post({ name: roleName("elsewhere"), branchCode: "GP01", parentRoleId: sibling.id })
    expect(elsewhere.json().error.code).toBe("OUTSIDE_BRANCH")
  })

  it("lets an admin give only permissions their own role has, and never the Super-Admin-only ones", async () => {
    const res = await post({ name: roleName("greedy"), branchCode: "GP01", permissions: ["INVOICES.FINALIZE"] })
    expect(res.statusCode).toBe(403)
    expect(res.json().error).toMatchObject({ code: "NOT_GRANTABLE", details: { permissions: ["INVOICES.FINALIZE"] } })
    // The admin's role has DROPDOWNS.VIEW, but only the Super Admin gives it.
    const dropdowns = await post({ name: roleName("dropdowns"), branchCode: "GP01", permissions: ["DROPDOWNS.VIEW"] })
    expect(dropdowns.json().error.code).toBe("NOT_GRANTABLE")
  })

  it("lets an admin take away only permissions they could give", async () => {
    const team = (await post({ name: roleName("given"), branchCode: "GP01" })).json()
    // The Super Admin gives the team a permission the admin doesn't have; the admin can't remove it.
    expect((await patch(team.id, { permissions: ["INVOICES.VIEW"] }, superAdmin.cookie)).statusCode).toBe(200)
    expect((await patch(team.id, { permissions: [] })).json().error.code).toBe("NOT_GRANTABLE")
    expect((await patch(team.id, { permissions: ["INVOICES.VIEW", "REPORTS.VIEW"] })).statusCode).toBe(200)
  })

  it("lets only the Super Admin move a role, and never under itself or below it", async () => {
    const top = (await post({ name: roleName("top"), branchCode: "GP01" })).json()
    const below = (await post({ name: roleName("below"), branchCode: "GP01", parentRoleId: top.id })).json()
    expect((await patch(below.id, { parentRoleId: adminRoleId })).json().error.code).toBe("PARENT_CHANGE")
    expect((await patch(top.id, { parentRoleId: below.id }, superAdmin.cookie)).json().error.code).toBe("PARENT_CHANGE")
    const moved = await patch(below.id, { parentRoleId: adminRoleId }, superAdmin.cookie)
    expect(moved.json()).toMatchObject({ parentRoleId: adminRoleId })
  })

  it("lets the Super Admin give any permission, including the Super-Admin-only ones", async () => {
    const payload = { name: roleName("trusted"), branchCode: "GP01", parentRoleId: systemId, permissions: ["SETTINGS.EDIT"] }
    const res = await post(payload, superAdmin.cookie)
    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ parentRoleId: systemId, canManage: true, permissions: ["SETTINGS.EDIT"] })
  })

  it("rejects a duplicate name with a clear message", async () => {
    const name = roleName("dup")
    expect((await post({ name, branchCode: "GP01" })).statusCode).toBe(201)
    const res = await post({ name, branchCode: "GP01" })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.message).toBe("A role with this name already exists")
  })

  it("gives the system role every permission and lets nobody change it", async () => {
    const everything = PERMISSION_DEFINITIONS.map((p) => p.key).sort()
    const got = await get(systemId, superAdmin.cookie)
    expect(got.json()).toMatchObject({ isSystem: true, parentRoleId: null, canManage: false })
    expect(got.json().permissions.sort()).toEqual(everything)
    expect((await patch(systemId, { description: "Everything" }, superAdmin.cookie)).json().error.code).toBe("SYSTEM_ROLE")

    const me = await app.inject({ url: "/api/v1/auth/me", headers: { cookie: superAdmin.cookie } })
    expect(me.json()).toMatchObject({ isSuperAdmin: true })
    expect(me.json().permissions.sort()).toEqual(everything)
  })
})
