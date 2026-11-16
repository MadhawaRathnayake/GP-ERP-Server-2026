import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { App } from "#app.js"
import { db } from "#core/db.js"
import { cleanupTestUsers, signIn, startApp, type TestUser } from "#test/helpers.js"

let app: App
let admin: TestUser // accessories and product edits
let viewer: TestUser // can only view
let productId: string
const name = `TEST-${Date.now()} WiFi module`

beforeAll(async () => {
  app = await startApp()
  admin = await signIn(app, ["ACCESSORIES.VIEW", "ACCESSORIES.CREATE", "ACCESSORIES.EDIT", "ACCESSORIES.DELETE", "PRODUCTS.VIEW", "PRODUCTS.EDIT"])
  viewer = await signIn(app, ["ACCESSORIES.VIEW", "PRODUCTS.VIEW"])
  const categoryId = (await db.category.create({ data: { name: `TEST-${Date.now()}` } })).id
  productId = (await db.product.create({ data: { sku: `TEST-${Date.now()}`, title: "Inverter", categoryId, warrantyMonths: 12, trackingType: "serial" } })).id
})

afterAll(async () => {
  await db.productAccessory.deleteMany({ where: { accessory: { name: { startsWith: "TEST-" } } } })
  await db.accessory.deleteMany({ where: { name: { startsWith: "TEST-" } } })
  await db.product.deleteMany({ where: { sku: { startsWith: "TEST-" } } })
  await db.category.deleteMany({ where: { name: { startsWith: "TEST-" } } })
  await cleanupTestUsers()
  await app.close()
})

describe("accessories", () => {
  let id: string
  const send = (method: "POST" | "PATCH" | "PUT" | "DELETE", url: string, payload?: object, who = admin) =>
    app.inject({ method, url: `/api/v1${url}`, headers: { cookie: who.cookie }, payload })

  it("creates one with an ACC id", async () => {
    const res = await send("POST", "/accessories", { name })
    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ name, description: "", productId: null, product: null, createdBy: admin.id })
    expect(res.json().id).toMatch(/^ACC\d{4,}$/)
    id = res.json().id
  })

  it("needs ACCESSORIES.CREATE to create", async () => {
    const res = await send("POST", "/accessories", { name: `${name} 2` }, viewer)
    expect(res.json().error.details).toEqual({ permission: "ACCESSORIES.CREATE" })
  })

  it("rejects a duplicate name with 409", async () => {
    expect((await send("POST", "/accessories", { name })).statusCode).toBe(409)
  })

  it("sets what comes with a product, replacing the list", async () => {
    const res = await send("PUT", `/products/${productId}/accessories`, { items: [{ accessoryId: id, quantity: 2 }] })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual([{ accessoryId: id, quantity: 2, accessory: { id, name, isDeleted: false } }])

    const list = await app.inject({ url: `/api/v1/products/${productId}/accessories`, headers: { cookie: viewer.cookie } })
    expect(list.json()).toHaveLength(1)
  })

  it("refuses to delete an accessory a product comes with", async () => {
    expect((await send("DELETE", `/accessories/${id}`)).statusCode).toBe(409)
    await send("PUT", `/products/${productId}/accessories`, { items: [] })
    expect((await send("DELETE", `/accessories/${id}`)).statusCode).toBe(204)
  })

  it("refuses a deleted accessory on a product", async () => {
    const res = await send("PUT", `/products/${productId}/accessories`, { items: [{ accessoryId: id, quantity: 1 }] })
    expect(res.statusCode).toBe(400)
  })
})
