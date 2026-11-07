import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { App } from "#app.js"
import { db } from "#core/db.js"
import { PERMISSION_DEFINITIONS } from "#security/permissions.js"
import { TEST_PREFIX, cleanupTestUsers, signIn, startApp, type TestUser } from "#test/helpers.js"

let app: App
let admin: TestUser
const roleName = (label: string) => `${TEST_PREFIX}${label}-${Date.now()}`

beforeAll(async () => {
  app = await startApp()
  admin = await signIn(app, ["ADMIN.VIEW", "ADMIN.MANAGE_ROLES"])
})

afterAll(async () => {
  await cleanupTestUsers()
  await app.close()
})

const post = (payload: object, cookie = admin.cookie) => app.inject({ method: "POST", url: "/api/v1/roles", headers: { cookie }, payload })
const patch = (id: string, payload: object, cookie = admin.cookie) =>
  app.inject({ method: "PATCH", url: `/api/v1/roles/${id}`, headers: { cookie }, payload })

describe("roles", () => {
  it("can be viewed with ADMIN.VIEW but only changed with ADMIN.MANAGE_ROLES", async () => {
    const viewer = await signIn(app, ["ADMIN.VIEW"])
    expect((await app.inject({ url: "/api/v1/roles", headers: { cookie: viewer.cookie } })).statusCode).toBe(200)
    expect((await post({ name: roleName("x") }, viewer.cookie)).statusCode).toBe(403)
  })

  it("creates, lists, gets and updates a role with its permissions", async () => {
    const name = roleName("clerk")
    const created = await post({ name, description: "Front desk", branchCode: "GP02", permissions: ["DASHBOARD.VIEW"] })
    expect(created.statusCode).toBe(201)
    const { id } = created.json()
    expect(id).toMatch(/^ROLE\d{4,}$/)

    const list = await app.inject({ url: "/api/v1/roles", headers: { cookie: admin.cookie } })
    expect(list.json().some((r: { id: string }) => r.id === id)).toBe(true)

    const updated = await patch(id, { permissions: ["DASHBOARD.VIEW", "REPORTS.VIEW"] })
    expect(updated.json()).toMatchObject({ name, description: "Front desk", branchCode: "GP02" })
    expect(updated.json().permissions.sort()).toEqual(["DASHBOARD.VIEW", "REPORTS.VIEW"])

    const renamed = await patch(id, { description: "Reception" })
    expect(renamed.json().permissions).toHaveLength(2) // untouched when not sent
  })

  it("rejects a duplicate name with a clear message", async () => {
    const name = roleName("dup")
    expect((await post({ name, branchCode: "GP01" })).statusCode).toBe(201)
    const res = await post({ name, branchCode: "GP01" })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.message).toBe("A role with this name already exists")
  })

  it("stops an admin from removing user management from their own role", async () => {
    const self = await signIn(app, ["ADMIN.VIEW", "ADMIN.MANAGE_ROLES", "ADMIN.MANAGE_USERS"])
    const res = await patch(self.roleId, { permissions: ["ADMIN.VIEW", "ADMIN.MANAGE_ROLES"] }, self.cookie)
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("SELF_LOCKOUT")
  })

  it("gives a system role every permission and keeps its name and permissions fixed", async () => {
    // No grant rows at all: a system role's permissions come from code.
    const system = await db.role.create({ data: { name: roleName("system"), isSystem: true } })
    const everything = PERMISSION_DEFINITIONS.map((p) => p.key).sort()

    const got = await app.inject({ url: `/api/v1/roles/${system.id}`, headers: { cookie: admin.cookie } })
    expect(got.json()).toMatchObject({ isSystem: true })
    expect(got.json().permissions.sort()).toEqual(everything)

    for (const change of [{ permissions: ["DASHBOARD.VIEW"] }, { name: roleName("renamed") }]) {
      const res = await patch(system.id, change)
      expect(res.statusCode).toBe(409)
      expect(res.json().error.code).toBe("SYSTEM_ROLE")
    }
    expect((await patch(system.id, { description: "Everything" })).json().description).toBe("Everything")

    const member = await signIn(app, { roleId: system.id })
    const me = await app.inject({ url: "/api/v1/auth/me", headers: { cookie: member.cookie } })
    expect(me.json().permissions.sort()).toEqual(everything)
  })
})
