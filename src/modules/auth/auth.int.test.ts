import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { App } from "#app.js"
import { db } from "#core/db.js"
import { TEST_PASSWORD, cleanupTestUsers, createTestRole, signIn, startApp, waitForChange } from "#test/helpers.js"

let app: App

beforeAll(async () => {
  app = await startApp()
})

afterAll(async () => {
  await cleanupTestUsers()
  await app.close()
})

const me = (cookie: string) => app.inject({ url: "/api/v1/auth/me", headers: { cookie } })

describe("auth", () => {
  it("rejects a wrong password without revealing whether the email exists", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: "nobody@test.local", password: "x" } })
    expect(res.statusCode).toBe(401)
    expect(res.json().error.message).toBe("Invalid email or password")
  })

  it("sets an httpOnly session cookie", async () => {
    const { email } = await signIn(app, [])
    const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email, password: TEST_PASSWORD } })
    expect(res.cookies[0]).toMatchObject({ httpOnly: true, path: "/", sameSite: "Lax" })
  })

  it("returns the user with their role's permissions", async () => {
    const role = await createTestRole(["DASHBOARD.VIEW", "PRODUCTS.VIEW"])
    const { id, cookie } = await signIn(app, { roleId: role.id })
    expect((await me(cookie)).json()).toMatchObject({ id, roleId: role.id, roleName: role.name })
    expect((await me(cookie)).json().permissions.sort()).toEqual(["DASHBOARD.VIEW", "PRODUCTS.VIEW"])
  })

  it("applies role permission changes to existing sessions on the next request", async () => {
    const { roleId, cookie } = await signIn(app, ["CUSTOMERS.VIEW"])
    expect((await app.inject({ url: "/api/v1/customers", headers: { cookie } })).statusCode).not.toBe(403)

    const changed = waitForChange("RolePermission")
    await db.rolePermission.deleteMany({ where: { roleId } })
    await changed

    expect((await app.inject({ url: "/api/v1/customers", headers: { cookie } })).statusCode).toBe(403)
  })

  it("applies a new role on the next request", async () => {
    const { id, cookie } = await signIn(app, [])
    const role = await createTestRole(["REPORTS.VIEW"])
    const changed = waitForChange("User")
    await db.user.update({ where: { id }, data: { roleId: role.id } })
    await changed

    expect((await me(cookie)).json().permissions).toEqual(["REPORTS.VIEW"])
  })

  it("ends the session when the user is deactivated", async () => {
    const { id, cookie } = await signIn(app, [])
    const changed = waitForChange("User")
    await db.user.update({ where: { id }, data: { isActive: false } })
    await changed

    expect((await me(cookie)).statusCode).toBe(401)
  })

  it("logs out", async () => {
    const { cookie } = await signIn(app, [])
    expect((await app.inject({ method: "POST", url: "/api/v1/auth/logout", headers: { cookie } })).statusCode).toBe(204)
    expect((await me(cookie)).statusCode).toBe(401)
  })

  it("keeps /docs and /api/v1/health public", async () => {
    expect((await app.inject({ url: "/api/v1/health" })).statusCode).toBe(200)
    expect((await app.inject({ url: "/docs/json" })).statusCode).toBe(200)
  })
})
