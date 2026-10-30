import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { App } from "#app.js"
import { db } from "#core/db.js"
import { cleanupTestUsers, signIn, startApp, waitForChange, type TestUser } from "#test/helpers.js"

let app: App
let user: TestUser // can view, create, edit and delete products
let outsider: TestUser // signed in, no product permissions
let categoryId: string
const sku = `TEST-${Date.now()}`

beforeAll(async () => {
  app = await startApp()
  user = await signIn(app, ["PRODUCTS.VIEW", "PRODUCTS.CREATE", "PRODUCTS.EDIT", "PRODUCTS.DELETE"])
  outsider = await signIn(app, ["DASHBOARD.VIEW"])
  categoryId = (await db.category.create({ data: { name: `TEST-${Date.now()}` } })).id
})

afterAll(async () => {
  const testProduct = { product: { sku: { startsWith: "TEST-" } } }
  await db.priceMovement.deleteMany({ where: testProduct })
  await db.costMovement.deleteMany({ where: testProduct })
  await db.stockMovement.deleteMany({ where: testProduct })
  await db.product.deleteMany({ where: { sku: { startsWith: "TEST-" } } })
  await db.category.deleteMany({ where: { name: { startsWith: "TEST-" } } })
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

  it("creates a product with a PROD id and records its opening price, cost and stock", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/products",
      headers: { cookie: user.cookie },
      payload: { sku, title: "Test item", categoryId, warrantyMonths: 12, trackingType: "serial", price: 10.5, cost: 7, stockInHand: 5, additionalInfo: "Black" },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ sku, description: "N/A", price: 10.5, cost: 7, stockInHand: 5, stockPreOrder: 0, additionalInfo: "Black", createdBy: user.id })
    expect(res.json().id).toMatch(/^PROD\d{6,}$/)
    id = res.json().id

    const price = await db.priceMovement.findMany({ where: { productId: id } })
    expect(price.map((m) => [m.previousPrice, m.price.toNumber()])).toEqual([[null, 10.5]])
    expect(await db.costMovement.count({ where: { productId: id } })).toBe(1)
    // Only buckets that aren't 0.
    const stock = await db.stockMovement.findMany({ where: { productId: id } })
    expect(stock.map((m) => [m.bucket, m.quantity, m.balanceAfter])).toEqual([["inHand", 5, 5]])
  })

  it("records a movement for each changed price, cost or stock value, and none for unchanged ones", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/products/${id}`,
      headers: { cookie: user.cookie },
      payload: { price: 12, cost: 7, stockInHand: 3, stockInTransit: 4 },
    })
    expect(res.json()).toMatchObject({ price: 12, cost: 7, stockInHand: 3, stockInTransit: 4 })

    const price = await db.priceMovement.findMany({ where: { productId: id }, orderBy: { id: "asc" } })
    expect(price.map((m) => [m.previousPrice?.toNumber() ?? null, m.price.toNumber()])).toEqual([[null, 10.5], [10.5, 12]])
    expect(await db.costMovement.count({ where: { productId: id } })).toBe(1)
    const stock = await db.stockMovement.findMany({ where: { productId: id }, orderBy: { id: "asc" } })
    expect(stock.slice(1).map((m) => [m.bucket, m.quantity, m.balanceAfter])).toEqual([["inHand", -2, 3], ["inTransit", 4, 4]])
  })

  it("rejects a duplicate sku with 409", async () => {
    const payload = { sku, title: "Dup", categoryId, warrantyMonths: 0, trackingType: "quantity" }
    expect((await app.inject({ method: "POST", url: "/api/v1/products", headers: { cookie: user.cookie }, payload })).statusCode).toBe(409)
  })

  it("rejects an unknown category with 400", async () => {
    const payload = { sku: `${sku}-X`, title: "X", categoryId: "CAT9999999", warrantyMonths: 0, trackingType: "quantity" }
    const res = await app.inject({ method: "POST", url: "/api/v1/products", headers: { cookie: user.cookie }, payload })
    expect(res.statusCode).toBe(400)
  })

  it("returns 400 with details for an invalid body", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/products", headers: { cookie: user.cookie }, payload: { sku: "", warrantyMonths: -1 } })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("VALIDATION_ERROR")
  })

  it("lists with sku and category filters in the { data, total } shape", async () => {
    const res = await app.inject({ url: `/api/v1/products?sku=${sku}&categoryId=${categoryId}&page=1&limit=5`, headers: { cookie: user.cookie } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ total: 1, data: [{ id, sku }] })
  })

  it("clears additionalInfo with null", async () => {
    const res = await app.inject({ method: "PATCH", url: `/api/v1/products/${id}`, headers: { cookie: user.cookie }, payload: { additionalInfo: null } })
    expect(res.json()).toMatchObject({ additionalInfo: null, modifiedBy: user.id })
  })

  it("serves repeat reads from Redis and refreshes after a DB change made outside the app", async () => {
    const url = `/api/v1/products/${id}`
    await app.inject({ url, headers: { cookie: user.cookie } })
    expect((await app.inject({ url, headers: { cookie: user.cookie } })).headers["x-cache"]).toBe("HIT")

    const changed = waitForChange("Product")
    // Raw SQL, bypassing services: only the trigger can notice this.
    await db.$executeRaw`UPDATE "Product" SET "warrantyMonths" = 24 WHERE id = ${id}`
    await changed

    const res = await app.inject({ url, headers: { cookie: user.cookie } })
    expect(res.headers["x-cache"]).toBe("MISS")
    expect(res.json().warrantyMonths).toBe(24)
  })

  it("checks access before serving a cached response", async () => {
    expect((await app.inject({ url: `/api/v1/products/${id}` })).statusCode).toBe(401)
    expect((await app.inject({ url: `/api/v1/products/${id}`, headers: { cookie: outsider.cookie } })).statusCode).toBe(403)
  })

  it("404s for an unknown id", async () => {
    const res = await app.inject({ url: "/api/v1/products/PROD9999999", headers: { cookie: user.cookie } })
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
