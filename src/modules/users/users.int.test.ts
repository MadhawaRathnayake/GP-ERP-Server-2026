import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { App } from "#app.js"
import { db } from "#core/db.js"
import { TEST_PASSWORD, TEST_PREFIX, cleanupTestUsers, createTestRole, login, signIn, startApp, type TestUser } from "#test/helpers.js"

let app: App
let admin: TestUser
let roleId: string // role for users created through the API
const email = (label: string) => `${TEST_PREFIX}${label}-${Date.now()}@test.local`
const ADMIN = ["ADMIN.VIEW", "ADMIN.MANAGE_USERS"] as const

beforeAll(async () => {
  app = await startApp()
  admin = await signIn(app, [...ADMIN])
  roleId = (await createTestRole(["DASHBOARD.VIEW"])).id
})

afterAll(async () => {
  await cleanupTestUsers()
  await app.close()
})

const create = (payload: object, cookie = admin.cookie) => app.inject({ method: "POST", url: "/api/v1/users", headers: { cookie }, payload })
const update = (id: string, payload: object, cookie = admin.cookie) =>
  app.inject({ method: "PATCH", url: `/api/v1/users/${id}`, headers: { cookie }, payload })
const remove = (id: string, cookie = admin.cookie) => app.inject({ method: "DELETE", url: `/api/v1/users/${id}`, headers: { cookie } })
const get = (id: string) => app.inject({ url: `/api/v1/users/${id}`, headers: { cookie: admin.cookie } })

describe("users", () => {
  it("can be viewed with ADMIN.VIEW but only changed with ADMIN.MANAGE_USERS", async () => {
    const viewer = await signIn(app, ["ADMIN.VIEW"])
    expect((await app.inject({ url: "/api/v1/users", headers: { cookie: viewer.cookie } })).statusCode).toBe(200)
    const res = await create({ name: "X", email: email("x"), password: "password1", roleId }, viewer.cookie)
    expect(res.statusCode).toBe(403)
    expect(res.json().error.details).toEqual({ permission: "ADMIN.MANAGE_USERS" })
  })

  it("creates a user with a USER00001-style id and audit fields", async () => {
    const res = await create({ name: "Jane Doe", email: email("Jane").toUpperCase(), password: "password1", roleId })
    expect(res.statusCode).toBe(201)
    const created = res.json()
    expect(created.id).toMatch(/^USER\d{5,}$/)
    expect(created).toMatchObject({
      name: "Jane Doe",
      roleId,
      roleName: expect.stringMatching(new RegExp(`^${TEST_PREFIX}`)),
      isActive: true,
      createdBy: admin.id,
      modifiedBy: null,
      modifiedAt: null,
    })
    expect(created.email).toBe(created.email.toLowerCase())
    expect(created).not.toHaveProperty("passwordHash")
  })

  it("numbers users in sequence", async () => {
    const first = (await create({ name: "Seq A", email: email("a"), password: "password1", roleId })).json().id
    const second = (await create({ name: "Seq B", email: email("b"), password: "password1", roleId })).json().id
    expect(Number(second.slice(4))).toBe(Number(first.slice(4)) + 1)
  })

  it("ignores audit fields sent by the client", async () => {
    const res = await create({ name: "Sneaky", email: email("sneaky"), password: "password1", roleId, createdBy: "USER99999", id: "USER99999" })
    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ createdBy: admin.id })
    expect(res.json().id).not.toBe("USER99999")
  })

  it("creates a user who can then sign in with their role's permissions", async () => {
    const role = await createTestRole(["REPORTS.VIEW"])
    const address = email("role")
    expect((await create({ name: "Role User", email: address, password: "password1", roleId: role.id })).statusCode).toBe(201)

    const cookie = await login(app, address, "password1")
    expect((await app.inject({ url: "/api/v1/auth/me", headers: { cookie } })).json().permissions).toEqual(["REPORTS.VIEW"])
  })

  it("rejects a duplicate email with a clear message", async () => {
    const address = email("dup")
    await create({ name: "First", email: address, password: "password1", roleId })
    const res = await create({ name: "Second", email: address, password: "password1", roleId })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.message).toBe("A user with this email already exists")
  })

  it("rejects an unknown role", async () => {
    const res = await create({ name: "X", email: email("norole"), password: "password1", roleId: "00000000-0000-4000-8000-000000000000" })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.message).toBe("The selected role does not exist")
  })

  it("validates the body", async () => {
    const res = await create({ name: "", email: "nope", password: "short" })
    expect(res.statusCode).toBe(400)
    const paths = res.json().error.details.map((d: { path: string }) => d.path)
    expect(paths).toEqual(expect.arrayContaining(["/name", "/email", "/password", "/roleId"]))
  })

  it("records who modified a user and when", async () => {
    const user = await signIn(app, ["DASHBOARD.VIEW"])
    const res = await update(user.id, { name: "Renamed" })
    expect(res.json()).toMatchObject({ name: "Renamed", modifiedBy: admin.id })
    expect(Date.now() - Date.parse(res.json().modifiedAt)).toBeLessThan(10_000)
  })

  it("updates profile and role separately", async () => {
    const user = await signIn(app, ["DASHBOARD.VIEW"])
    expect((await update(user.id, { name: "Only name" })).json()).toMatchObject({ name: "Only name", roleId: user.roleId })
    const res = await update(user.id, { roleId })
    expect(res.json()).toMatchObject({ name: "Only name", roleId })
  })

  it("replaces a password: the old one stops working and the user's sessions end", async () => {
    const user = await signIn(app, ["DASHBOARD.VIEW"])
    expect((await update(user.id, { password: "brand-new-password" })).statusCode).toBe(200)

    expect((await app.inject({ url: "/api/v1/auth/me", headers: { cookie: user.cookie } })).statusCode).toBe(401)
    expect((await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: user.email, password: TEST_PASSWORD } })).statusCode).toBe(401)
    await expect(login(app, user.email, "brand-new-password")).resolves.toBeTruthy()
  })

  it("keeps an admin signed in when they replace their own password", async () => {
    const self = await signIn(app, [...ADMIN])
    expect((await update(self.id, { password: "my-new-password" }, self.cookie)).statusCode).toBe(200)
    expect((await app.inject({ url: "/api/v1/auth/me", headers: { cookie: self.cookie } })).statusCode).toBe(200)
  })

  it("deletes softly: the row stays with isActive false, the user is signed out and hidden from the list", async () => {
    const user = await signIn(app, ["DASHBOARD.VIEW"])
    expect((await remove(user.id)).statusCode).toBe(204)

    expect((await get(user.id)).json()).toMatchObject({ id: user.id, isActive: false, modifiedBy: admin.id })
    expect((await app.inject({ url: "/api/v1/auth/me", headers: { cookie: user.cookie } })).statusCode).toBe(401)
    expect((await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: user.email, password: TEST_PASSWORD } })).statusCode).toBe(401)

    const ids = (cookie: string, query = "") =>
      app.inject({ url: `/api/v1/users${query}`, headers: { cookie } }).then((r) => r.json().map((u: { id: string }) => u.id))
    expect(await ids(admin.cookie)).not.toContain(user.id)
    expect(await ids(admin.cookie, "?includeInactive=true")).toContain(user.id)
  })

  it("restores a deleted user", async () => {
    const user = await signIn(app, [])
    await remove(user.id)
    expect((await update(user.id, { isActive: true })).json().isActive).toBe(true)
    await expect(login(app, user.email, TEST_PASSWORD)).resolves.toBeTruthy()
  })

  it("stops an admin from locking themselves out", async () => {
    const self = await signIn(app, [...ADMIN])
    for (const change of [{ isActive: false }, { roleId }]) {
      const res = await update(self.id, change, self.cookie)
      expect(res.statusCode).toBe(409)
      expect(res.json().error.code).toBe("SELF_LOCKOUT")
    }
    expect((await remove(self.id, self.cookie)).json().error.code).toBe("SELF_LOCKOUT")

    // Other admins can still be changed.
    const other = await signIn(app, [...ADMIN])
    expect((await remove(other.id, self.cookie)).statusCode).toBe(204)
  })

  it("validates the id format and 404s for an unknown user", async () => {
    expect((await get("42")).statusCode).toBe(400)
    expect((await update("USER99999999", { name: "X" })).statusCode).toBe(404)
  })

  it("never stores the plain password", async () => {
    const address = email("hash")
    await create({ name: "Hash Check", email: address, password: "password1", roleId })
    const row = await db.user.findUniqueOrThrow({ where: { email: address }, omit: { passwordHash: false } })
    expect(row.passwordHash).toMatch(/^scrypt\$/)
  })
})
