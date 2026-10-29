import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fp from "fastify-plugin"
import type { App } from "#app.js"
import type { CurrentUser } from "#security/current-user.js"

// Boots the real app with Postgres/Redis stubbed out: checks route wiring, access control and the generated API docs
// without any services running.

const { SESSION_ID, user } = vi.hoisted(() => ({
  SESSION_ID: "valid-test-session",
  // Signed in, but with no permissions.
  user: {
    id: "USER00001",
    name: "Test",
    email: "t@test.local",
    roleId: "00000000-0000-4000-8000-000000000000",
    roleName: "No access",
    permissions: [],
  } as CurrentUser,
}))

vi.mock("#core/connections.plugin.js", () => ({ default: fp(async () => {}, { name: "connections" }) }))
vi.mock("#cache/db-events.plugin.js", () => ({ default: fp(async () => {}, { name: "db-events" }) }))
vi.mock("#security/permissions-sync.plugin.js", () => ({ default: fp(async () => {}, { name: "permissions-sync" }) }))
vi.mock("#security/sessions.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("#security/sessions.js")>()
  return {
    ...actual,
    sessions: {
      ...actual.sessions,
      touch: async (id: string) => (id === SESSION_ID ? { userId: user.id, createdAt: new Date().toISOString() } : null),
    },
  }
})
vi.mock("#security/current-user.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("#security/current-user.js")>()),
  getCurrentUser: async () => user,
}))

let app: App
const signedIn = { cookie: `sid=${SESSION_ID}` }
const anId = "00000000-0000-4000-8000-000000000002"
const aUserId = "USER00002"

beforeAll(async () => {
  const { buildApp } = await import("#app.js")
  app = await buildApp()
  await app.ready()
})

afterAll(() => app.close())

describe("app wiring", () => {
  it("mounts every module under /api/v1/<folder>", () => {
    const routes = app.printRoutes({ commonPrefix: false })
    for (const path of ["/api/v1/products", "/api/v1/customers", "/api/v1/users", "/api/v1/roles", "/api/v1/permissions", "/api/v1/settings", "/api/v1/auth/login", "/api/v1/health"]) {
      expect(routes).toContain(path)
    }
  })

  it.each(["/api/v1/products", "/api/v1/customers", "/api/v1/users", "/api/v1/settings", "/api/v1/auth/me"])("%s needs a session by default", async (url) => {
    const res = await app.inject({ url })
    expect(res.statusCode).toBe(401)
    expect(res.json().error).toMatchObject({ code: "UNAUTHENTICATED", requestId: expect.any(String) })
    expect(res.headers["x-request-id"]).toBe(res.json().error.requestId)
  })

  // Every route that requires a permission, and which one. A route losing its `permission` config fails this test.
  it.each([
    ["GET", "/api/v1/products", "PRODUCTS.VIEW"],
    ["GET", `/api/v1/products/${anId}`, "PRODUCTS.VIEW"],
    ["POST", "/api/v1/products", "PRODUCTS.CREATE"],
    ["PATCH", `/api/v1/products/${anId}`, "PRODUCTS.EDIT"],
    ["DELETE", `/api/v1/products/${anId}`, "PRODUCTS.DELETE"],
    ["GET", "/api/v1/customers", "CUSTOMERS.VIEW"],
    ["GET", `/api/v1/customers/${anId}`, "CUSTOMERS.VIEW"],
    ["GET", "/api/v1/users", "ADMIN.VIEW"],
    ["GET", `/api/v1/users/${aUserId}`, "ADMIN.VIEW"],
    ["POST", "/api/v1/users", "ADMIN.MANAGE_USERS"],
    ["PATCH", `/api/v1/users/${aUserId}`, "ADMIN.MANAGE_USERS"],
    ["DELETE", `/api/v1/users/${aUserId}`, "ADMIN.MANAGE_USERS"],
    ["GET", "/api/v1/roles", "ADMIN.VIEW"],
    ["GET", `/api/v1/roles/${anId}`, "ADMIN.VIEW"],
    ["POST", "/api/v1/roles", "ADMIN.MANAGE_ROLES"],
    ["PATCH", `/api/v1/roles/${anId}`, "ADMIN.MANAGE_ROLES"],
    ["GET", "/api/v1/permissions", "ADMIN.VIEW"],
    ["PATCH", "/api/v1/settings", "ADMIN.EDIT_SETTINGS"],
  ] as const)("%s %s requires %s", async (method, url, permission) => {
    const res = await app.inject({ method, url, headers: signedIn, payload: method === "GET" || method === "DELETE" ? undefined : {} })
    expect(res.statusCode).toBe(403)
    expect(res.json().error).toMatchObject({ code: "FORBIDDEN", details: { permission } })
  })

  it("lets any signed-in user read their own profile", async () => {
    const res = await app.inject({ url: "/api/v1/auth/me", headers: signedIn })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual(user)
  })

  it("lets the frontend origin send every method the API uses, with cookies", async () => {
    for (const method of ["POST", "PATCH", "DELETE"]) {
      const res = await app.inject({
        method: "OPTIONS",
        url: `/api/v1/users/${aUserId}`,
        headers: { origin: "http://localhost:5173", "access-control-request-method": method },
      })
      expect(res.statusCode).toBe(204)
      expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:5173")
      expect(res.headers["access-control-allow-credentials"]).toBe("true")
      expect(String(res.headers["access-control-allow-methods"])).toContain(method)
    }
  })

  it("validates login input before touching the database", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: "not-an-email" } })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("VALIDATION_ERROR")
  })

  it("returns the standard error shape for unknown routes", async () => {
    const res = await app.inject({ url: "/api/v1/nope" })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("ROUTE_NOT_FOUND")
  })

  it("documents tag, session security and permission per route", async () => {
    const spec = (await app.inject({ url: "/docs/json" })).json()
    const createUser = spec.paths["/api/v1/users/"].post
    expect(createUser.tags).toEqual(["users"])
    expect(createUser.security).toEqual([{ session: [] }])
    expect(createUser.description).toContain("`ADMIN.MANAGE_USERS`")

    const userSchema = createUser.responses["201"].content["application/json"].schema
    expect(Object.keys(userSchema.properties)).toEqual(expect.arrayContaining(["createdBy", "createdAt", "modifiedBy", "modifiedAt", "isActive"]))
    expect(Object.keys(userSchema.properties)).not.toContain("passwordHash")

    const price = spec.paths["/api/v1/products/{id}"].get.responses["200"].content["application/json"].schema.properties.price
    expect(price.type).toBe("number")

    expect(spec.paths["/api/v1/auth/login"].post.security).toBeUndefined()
  })
})
