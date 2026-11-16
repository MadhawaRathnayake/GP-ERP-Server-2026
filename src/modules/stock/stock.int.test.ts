import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { App } from "#app.js"
import { dbEvents } from "#cache/db-events.plugin.js"
import { db } from "#core/db.js"
import { cleanupTestUsers, signIn, startApp, type TestUser } from "#test/helpers.js"
import { STOCK_CHANGE_CHANNEL } from "./stock.events.js"

let app: App
let user: TestUser // can view, create and edit products, and adjust their stock
let outsider: TestUser // signed in, no product permissions
let productId: string

/** Resolves with the next stock_change payload for `id` (sent by the trigger once the change commits). */
function nextStockChange(id: string): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const onNotification = (channel: string, payload: string) => {
      const level = JSON.parse(payload) as Record<string, unknown>
      if (channel !== STOCK_CHANGE_CHANNEL || level.id !== id) return
      dbEvents.off("notification", onNotification)
      resolve(level)
    }
    dbEvents.on("notification", onNotification)
  })
}

const adjustStock = (quantity: number) =>
  app.inject({
    method: "POST",
    url: `/api/v1/products/${productId}/stock-adjustments`,
    headers: { cookie: user.cookie },
    payload: { quantity, reason: "Stock test" },
  })

beforeAll(async () => {
  app = await startApp()
  user = await signIn(app, ["PRODUCTS.VIEW", "PRODUCTS.CREATE", "PRODUCTS.EDIT", "PRODUCTS.ADJUST_STOCK"])
  outsider = await signIn(app, ["DASHBOARD.VIEW"])
  const categoryId = (await db.category.create({ data: { name: `TEST-${Date.now()}` } })).id
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/products",
    headers: { cookie: user.cookie },
    payload: { sku: `TEST-${Date.now()}`, title: "Stock test", categoryId, warrantyMonths: 0, trackingType: "quantity" },
  })
  productId = res.json().id
  await adjustStock(5)
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

describe("stock", () => {
  it.each(["/api/v1/stock", "/api/v1/stock/events"])("%s requires PRODUCTS.VIEW", async (url) => {
    const res = await app.inject({ url, headers: { cookie: outsider.cookie } })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.details).toEqual({ permission: "PRODUCTS.VIEW" })
  })

  it("lists the stock of every active product", async () => {
    const res = await app.inject({ url: "/api/v1/stock", headers: { cookie: user.cookie } })
    expect(res.statusCode).toBe(200)
    const level = res.json().find((level: { id: string }) => level.id === productId)
    // Not 0: the opening stock was added by an adjustment, which is a stock change.
    expect(level).toEqual({ id: productId, stockInHand: 5, stockVersion: expect.any(Number) })
    expect(level.stockVersion).toBeGreaterThan(0)
  })

  it("gives a stock change a higher version and announces it after the commit", async () => {
    const before = (await app.inject({ url: `/api/v1/products/${productId}`, headers: { cookie: user.cookie } })).json().stockVersion
    const announced = nextStockChange(productId)

    const res = await adjustStock(-2)
    expect(res.statusCode).toBe(200)
    expect(res.json().stockVersion).toBeGreaterThan(before)
    expect(await announced).toEqual({ id: productId, stockInHand: 3, stockVersion: res.json().stockVersion })
  })

  it("keeps the version when an edit doesn't change stock", async () => {
    const before = (await app.inject({ url: `/api/v1/products/${productId}`, headers: { cookie: user.cookie } })).json()
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/products/${productId}`,
      headers: { cookie: user.cookie },
      payload: { title: "Stock test (renamed)" },
    })
    expect(res.json().stockVersion).toBe(before.stockVersion)
  })

  it("streams stock changes to a signed-in browser", async () => {
    const address = await app.listen({ port: 0, host: "127.0.0.1" })
    const res = await fetch(`${address}/api/v1/stock/events`, { headers: { cookie: user.cookie } })
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("text/event-stream; charset=utf-8")

    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let text = ""
    // The stream is open once the retry line arrives; only then is the change sure to reach it.
    while (!text.includes("retry:")) text += decoder.decode((await reader.read()).value, { stream: true })

    const saved = (await adjustStock(4)).json()
    const expected = `event: stock\ndata: ${JSON.stringify({ id: productId, stockInHand: 7, stockVersion: saved.stockVersion })}\n\n`
    while (!text.includes(expected)) text += decoder.decode((await reader.read()).value, { stream: true })
    await reader.cancel()
  })
})
