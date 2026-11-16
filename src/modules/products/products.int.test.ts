import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { App } from "#app.js"
import { db } from "#core/db.js"
import { cleanupTestUsers, signIn, startApp, waitForChange, type TestUser } from "#test/helpers.js"

let app: App
let user: TestUser // can view, create, edit and delete products, and adjust their stock
let outsider: TestUser // signed in, no product permissions
let categoryId: string
const sku = `TEST-${Date.now()}`

beforeAll(async () => {
  app = await startApp()
  user = await signIn(app, ["PRODUCTS.VIEW", "PRODUCTS.CREATE", "PRODUCTS.EDIT", "PRODUCTS.DELETE", "PRODUCTS.ADJUST_STOCK"])
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

  it("creates a product with a PROD id, no stock, and records its opening price and cost", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/products",
      headers: { cookie: user.cookie },
      payload: { sku, title: "Test item", categoryId, warrantyMonths: 12, trackingType: "quantity", price: 10.5, cost: 7, stockInHand: 5, additionalInfo: "Black" },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ sku, description: null, price: 10.5, cost: 7, stockInHand: 0, additionalInfo: "Black", createdBy: user.id })
    expect(res.json().id).toMatch(/^PROD\d{6,}$/)
    id = res.json().id

    const price = await db.priceMovement.findMany({ where: { productId: id } })
    expect(price.map((m) => [m.previousPrice, m.price.toNumber()])).toEqual([[null, 10.5]])
    expect(await db.costMovement.count({ where: { productId: id } })).toBe(1)
    expect(await db.stockMovement.count({ where: { productId: id } })).toBe(0)
  })

  it("records a movement for each changed price or cost, none for unchanged ones, and ignores stock", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/products/${id}`,
      headers: { cookie: user.cookie },
      payload: { price: 12, cost: 7, stockInHand: 3 },
    })
    expect(res.json()).toMatchObject({ price: 12, cost: 7, stockInHand: 0 })

    const price = await db.priceMovement.findMany({ where: { productId: id }, orderBy: { id: "asc" } })
    expect(price.map((m) => [m.previousPrice?.toNumber() ?? null, m.price.toNumber()])).toEqual([[null, 10.5], [10.5, 12]])
    expect(await db.costMovement.count({ where: { productId: id } })).toBe(1)
    expect(await db.stockMovement.count({ where: { productId: id } })).toBe(0)
  })

  describe("stock adjustments", () => {
    const adjust = (productId: string, payload: object, who = user) =>
      app.inject({ method: "POST", url: `/api/v1/products/${productId}/stock-adjustments`, headers: { cookie: who.cookie }, payload })

    it("require PRODUCTS.ADJUST_STOCK", async () => {
      const editor = await signIn(app, ["PRODUCTS.VIEW", "PRODUCTS.EDIT"])
      const res = await adjust(id, { quantity: 1, reason: "Count" }, editor)
      expect(res.statusCode).toBe(403)
      expect(res.json().error.details).toEqual({ permission: "PRODUCTS.ADJUST_STOCK" })
    })

    it("add and take stock, each recorded with its reason", async () => {
      expect((await adjust(id, { quantity: 5, reason: "Opening count" })).json()).toMatchObject({ stockInHand: 5, modifiedBy: user.id })
      expect((await adjust(id, { quantity: -2, reason: "Damaged" })).json()).toMatchObject({ stockInHand: 3 })
      const stock = await db.stockMovement.findMany({ where: { productId: id }, orderBy: { id: "asc" } })
      expect(stock.map((m) => [m.quantity, m.balanceAfter, m.remarks, m.reference, m.createdBy])).toEqual([
        [5, 5, "Opening count", null, user.id],
        [-2, 3, "Damaged", null, user.id],
      ])
    })

    it("refuse to go below 0", async () => {
      const res = await adjust(id, { quantity: -4, reason: "Count" })
      expect(res.statusCode).toBe(409)
      expect(res.json().error).toMatchObject({ code: "STOCK_BELOW_ZERO", details: { inHand: 3 } })
    })

    it("refuse units for a quantity-tracked product", async () => {
      const res = await adjust(id, { reason: "Count", add: [{ serialNumber: `TEST-SN-${Date.now()}` }] })
      expect(res.statusCode).toBe(409)
      expect(res.json().error.code).toBe("TRACKING_MISMATCH")
    })

    it("lock the tracking type while the product has stock", async () => {
      const res = await app.inject({ method: "PATCH", url: `/api/v1/products/${id}`, headers: { cookie: user.cookie }, payload: { trackingType: "serial" } })
      expect(res.statusCode).toBe(409)
      expect(res.json().error.code).toBe("TRACKING_TYPE_LOCKED")
    })

    describe("of a serial-tracked product", () => {
      let serialId: string
      const serial = (n: number) => `TEST-SN-${sku}-${n}`

      beforeAll(async () => {
        // Its own sku prefix, so the sku searches below still find one product.
        const payload = { sku: `TEST-SP-${Date.now()}`, title: "Serial item", categoryId, warrantyMonths: 12, trackingType: "serial" }
        serialId = (await app.inject({ method: "POST", url: "/api/v1/products", headers: { cookie: user.cookie }, payload })).json().id
      })

      afterAll(async () => {
        const units = { serialItem: { productId: serialId } }
        await db.serialItemMovement.deleteMany({ where: units })
        await db.serialItemAccessory.deleteMany({ where: units })
        await db.serialItem.deleteMany({ where: { productId: serialId } })
      })

      it("refuse a quantity (its stock comes with serial numbers)", async () => {
        const res = await adjust(serialId, { quantity: 1, reason: "Count" })
        expect(res.statusCode).toBe(409)
        expect(res.json().error.code).toBe("TRACKING_MISMATCH")
      })

      it("add units: stock goes up by as many, each unit with a movement", async () => {
        const res = await adjust(serialId, { reason: "Found", add: [{ serialNumber: serial(1) }, { serialNumber: serial(2), palletNumber: "P1" }] })
        expect(res.statusCode).toBe(200)
        expect(res.json().stockInHand).toBe(2)
        const units = await db.serialItem.findMany({ where: { productId: serialId }, include: { movements: true }, orderBy: { id: "asc" } })
        expect(units.map((u) => [u.serialNumber, u.palletNumber, u.status])).toEqual([
          [serial(1), null, "inStock"],
          [serial(2), "P1", "inStock"],
        ])
        expect(units[0]!.movements).toMatchObject([{ fromStatus: null, toStatus: "inStock", remarks: "Found", createdBy: user.id }])
      })

      it("refuse a serial that is already used, ignoring case, or repeated in the list", async () => {
        const res = await adjust(serialId, { reason: "Found", add: [{ serialNumber: serial(1).toLowerCase() }, { serialNumber: serial(3) }, { serialNumber: serial(3) }] })
        expect(res.statusCode).toBe(409)
        expect(res.json().error).toMatchObject({ code: "SERIAL_NUMBERS_TAKEN", details: { serialNumbers: [serial(1).toLowerCase(), serial(3)] } })
        expect((await db.product.findUniqueOrThrow({ where: { id: serialId } })).stockInHand).toBe(2)
      })

      it("remove units in stock: stock goes down by as many", async () => {
        const unit = await db.serialItem.findFirstOrThrow({ where: { serialNumber: serial(1) } })
        const res = await adjust(serialId, { reason: "Damaged", remove: [unit.id] })
        expect(res.json().stockInHand).toBe(1)
        expect((await db.serialItem.findUniqueOrThrow({ where: { id: unit.id } })).status).toBe("removed")
        const again = await adjust(serialId, { reason: "Damaged", remove: [unit.id] })
        expect(again.json().error.code).toBe("SERIAL_ITEMS_NOT_AVAILABLE")
      })

      it("register serials only for stock that has none, without changing stock", async () => {
        const refused = await adjust(serialId, { reason: "Old stock", register: [{ serialNumber: serial(4) }] })
        expect(refused.json().error).toMatchObject({ code: "NOTHING_TO_REGISTER", details: { withoutSerial: 0 } })

        await db.product.update({ where: { id: serialId }, data: { stockInHand: 3 } }) // old stock without serials
        const res = await adjust(serialId, { reason: "Old stock", register: [{ serialNumber: serial(4) }] })
        expect(res.json().stockInHand).toBe(3)
        expect(await db.serialItem.count({ where: { productId: serialId, status: "inStock" } })).toBe(2)
      })

      it("lock the tracking type once the product has units", async () => {
        const res = await app.inject({ method: "PATCH", url: `/api/v1/products/${serialId}`, headers: { cookie: user.cookie }, payload: { trackingType: "quantity" } })
        expect(res.statusCode).toBe(409)
        expect(res.json().error.code).toBe("TRACKING_TYPE_LOCKED")
      })
    })

    it("404 for an unknown product", async () => {
      expect((await adjust("PROD9999999", { quantity: 1, reason: "Count" })).statusCode).toBe(404)
    })
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
    expect(res.json()).toMatchObject({ isDeleted: true, modifiedBy: user.id })
    const list = await app.inject({ url: `/api/v1/products?sku=${sku}`, headers: { cookie: user.cookie } })
    expect(list.json().total).toBe(0)
  })
})
