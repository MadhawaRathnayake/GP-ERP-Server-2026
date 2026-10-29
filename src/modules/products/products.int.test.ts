import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { App } from "#app.js"
import { db } from "#core/db.js"
import { cleanupTestUsers, signIn, startApp, waitForChange, type TestUser } from "#test/helpers.js"

let app: App
let user: TestUser // can view, create, edit and delete products
let outsider: TestUser // signed in, no product permissions
const sku = `TEST-${Date.now()}`

beforeAll(async () => {
  app = await startApp()
  user = await signIn(app, ["PRODUCTS.VIEW", "PRODUCTS.CREATE", "PRODUCTS.EDIT", "PRODUCTS.DELETE"])
  outsider = await signIn(app, ["DASHBOARD.VIEW"])
})

afterAll(async () => {
  await db.product.deleteMany({ where: { sku: { startsWith: "TEST-" } } })
  await cleanupTestUsers()
  await app.close()
})

describe("products", () => {
  let id: string

  it("requires a session", async () => {
    const res = await app.inject({ url: "/api/v1/products" })
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe("UNAUTHENTICATED")
  })

  it("requires PRODUCTS.VIEW", async () => {
    const res = await app.inject({ url: "/api/v1/products", headers: { cookie: outsider.cookie } })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.details).toEqual({ permission: "PRODUCTS.VIEW" })
  })

  it("creates a product (Decimal money in, number out)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/products",
      headers: { cookie: user.cookie },
      payload: { sku, name: "Test item", price: 10.5, cost: 7 },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ sku, price: 10.5, cost: 7, status: "active", stock: 0 })
    id = res.json().id
  })

  it("rejects a duplicate sku with 409", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/products", headers: { cookie: user.cookie }, payload: { sku, name: "Dup", price: 1, cost: 1 } })
    expect(res.statusCode).toBe(409)
  })

  it("returns 400 with details for an invalid body", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/products", headers: { cookie: user.cookie }, payload: { sku: "", price: -1 } })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("VALIDATION_ERROR")
  })

  it("lists with sku filter in the { data, total } shape", async () => {
    const res = await app.inject({ url: `/api/v1/products?sku=${sku}&page=1&limit=5`, headers: { cookie: user.cookie } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ total: 1, data: [{ id, sku, price: 10.5 }] })
  })

  it("serves repeat reads from Redis and refreshes after a DB change made outside the app", async () => {
    const url = `/api/v1/products/${id}`
    await app.inject({ url, headers: { cookie: user.cookie } })
    expect((await app.inject({ url, headers: { cookie: user.cookie } })).headers["x-cache"]).toBe("HIT")

    const changed = waitForChange("Product")
    // Raw SQL, bypassing services: only the trigger can notice this.
    await db.$executeRaw`UPDATE "Product" SET price = 99 WHERE id = ${id}::uuid`
    await changed

    const res = await app.inject({ url, headers: { cookie: user.cookie } })
    expect(res.headers["x-cache"]).toBe("MISS")
    expect(res.json().price).toBe(99)
  })

  it("checks access before serving a cached response", async () => {
    expect((await app.inject({ url: `/api/v1/products/${id}` })).statusCode).toBe(401)
    expect((await app.inject({ url: `/api/v1/products/${id}`, headers: { cookie: outsider.cookie } })).statusCode).toBe(403)
  })

  it("404s for an unknown id", async () => {
    const res = await app.inject({ url: "/api/v1/products/00000000-0000-4000-8000-000000000000", headers: { cookie: user.cookie } })
    expect(res.statusCode).toBe(404)
  })

  it("deletes softly: deactivated, hidden from the list, kept with its history", async () => {
    const changed = waitForChange("Product")
    expect((await app.inject({ method: "DELETE", url: `/api/v1/products/${id}`, headers: { cookie: user.cookie } })).statusCode).toBe(204)
    await changed
    const res = await app.inject({ url: `/api/v1/products/${id}`, headers: { cookie: user.cookie } })
    expect(res.json()).toMatchObject({ isActive: false, modifiedBy: user.id })
    const list = await app.inject({ url: `/api/v1/products?sku=${sku}`, headers: { cookie: user.cookie } })
    expect(list.json().total).toBe(0)
  })
})
