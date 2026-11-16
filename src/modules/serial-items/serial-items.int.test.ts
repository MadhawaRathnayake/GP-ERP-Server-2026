import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { App } from "#app.js"
import { db } from "#core/db.js"
import { cleanupTestUsers, signIn, startApp, type TestUser } from "#test/helpers.js"

let app: App
let user: TestUser // views and corrects units, adjusts stock
let outsider: TestUser // signed in, no serial permissions
let productId: string
let accessoryId: string
const stamp = Date.now()
const serial = (n: number) => `TEST-SI-${stamp}-${n}`
const wifi = (n: number) => `TEST-WF-${stamp}-${n}`

beforeAll(async () => {
  app = await startApp()
  user = await signIn(app, ["SERIAL_ITEMS.VIEW", "SERIAL_ITEMS.EDIT", "PRODUCTS.ADJUST_STOCK"])
  outsider = await signIn(app, ["DASHBOARD.VIEW"])
  const categoryId = (await db.category.create({ data: { name: `TEST-${stamp}` } })).id
  productId = (await db.product.create({ data: { sku: `TEST-${stamp}`, title: "Inverter", categoryId, warrantyMonths: 60, trackingType: "serial" } })).id
  accessoryId = (await db.accessory.create({ data: { name: `TEST-${stamp} WiFi` } })).id

  const res = await app.inject({
    method: "POST",
    url: `/api/v1/products/${productId}/stock-adjustments`,
    headers: { cookie: user.cookie },
    payload: {
      reason: "Opening count",
      add: [
        { serialNumber: serial(1), palletNumber: "PAL-1", accessories: [{ accessoryId, serialNumber: wifi(1) }] },
        { serialNumber: serial(2), palletNumber: "PAL-1" },
      ],
    },
  })
  expect(res.statusCode).toBe(200)
})

afterAll(async () => {
  const units = { serialItem: { productId } }
  await db.serialItemMovement.deleteMany({ where: units })
  await db.serialItemAccessory.deleteMany({ where: units })
  await db.serialItem.deleteMany({ where: { productId } })
  await db.stockMovement.deleteMany({ where: { productId } })
  await db.accessory.deleteMany({ where: { name: { startsWith: "TEST-" } } })
  await db.product.deleteMany({ where: { sku: { startsWith: "TEST-" } } })
  await db.category.deleteMany({ where: { name: { startsWith: "TEST-" } } })
  await cleanupTestUsers()
  await app.close()
})

describe("serial items", () => {
  const get = (url: string, who = user) => app.inject({ url: `/api/v1/serial-items${url}`, headers: { cookie: who.cookie } })

  it("requires SERIAL_ITEMS.VIEW", async () => {
    const res = await get("", outsider)
    expect(res.statusCode).toBe(403)
    expect(res.json().error.details).toEqual({ permission: "SERIAL_ITEMS.VIEW" })
  })

  it("finds a unit by its serial, an accessory serial or its pallet, ignoring case", async () => {
    for (const search of [serial(1).toLowerCase(), wifi(1), "pal-1"]) {
      const res = await get(`?productId=${productId}&search=${search}`)
      expect(res.json().data.map((unit: { serialNumber: string }) => unit.serialNumber)).toContain(serial(1))
    }
    const page = (await get(`?productId=${productId}&status=inStock`)).json()
    expect(page.total).toBe(2)
    expect(page.data[0]).toMatchObject({ product: { id: productId }, status: "inStock", invoiceId: null })
  })

  it("shows a unit with its accessories and history", async () => {
    const id = (await db.serialItem.findFirstOrThrow({ where: { serialNumber: serial(1) } })).id
    const res = await get(`/${id}`)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      serialNumber: serial(1),
      accessories: [{ serialNumber: wifi(1), accessory: { id: accessoryId } }],
      invoice: null,
      movements: [{ fromStatus: null, toStatus: "inStock", remarks: "Opening count", creator: { id: user.id } }],
    })
  })

  it("checks serials before they are saved", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/serial-items/check",
      headers: { cookie: user.cookie },
      payload: { serialNumbers: [serial(3), serial(3), serial(2).toLowerCase(), wifi(1)] },
    })
    expect(res.json().map((row: { result: string }) => row.result)).toEqual(["new", "repeated", "exists", "exists"])
    expect(res.json()[2].existing).toMatchObject({ sku: `TEST-${stamp}` })
  })

  it("corrects a serial, recorded as a movement, and refuses one already used", async () => {
    const id = (await db.serialItem.findFirstOrThrow({ where: { serialNumber: serial(2) } })).id
    const patch = (payload: object) =>
      app.inject({ method: "PATCH", url: `/api/v1/serial-items/${id}`, headers: { cookie: user.cookie }, payload })

    expect((await patch({ serialNumber: wifi(1) })).json().error.code).toBe("SERIAL_NUMBERS_TAKEN")
    const res = await patch({ serialNumber: serial(5) })
    expect(res.statusCode).toBe(200)
    expect(res.json().serialNumber).toBe(serial(5))
    expect(res.json().movements.at(-1).remarks).toBe(`Serial corrected: ${serial(2)} → ${serial(5)}`)
  })

  it("lists serial products whose stock isn't their units in stock", async () => {
    expect((await get("/stock-check")).json().some((row: { productId: string }) => row.productId === productId)).toBe(false)
    await db.product.update({ where: { id: productId }, data: { stockInHand: 5 } })
    const row = (await get("/stock-check")).json().find((row: { productId: string }) => row.productId === productId)
    expect(row).toMatchObject({ stockInHand: 5, unitsInStock: 2, withoutSerial: 3 })
  })
})
