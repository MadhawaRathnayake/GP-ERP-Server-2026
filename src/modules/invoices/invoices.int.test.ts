import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { App } from "#app.js"
import { db } from "#core/db.js"
import { cleanupTestUsers, signIn, startApp, type TestUser } from "#test/helpers.js"

// Uses ERP-DB like every integration test, and also uses up this month's invoice numbers (NumberSequence).

let app: App
let user: TestUser // every invoice permission
let viewer: TestUser
let customerId: string
let productId: string
let quotationId: number
const stamp = Date.now()

beforeAll(async () => {
  app = await startApp()
  user = await signIn(app, ["INVOICES.VIEW", "INVOICES.CREATE", "INVOICES.EDIT", "INVOICES.ADD_SERIALS", "INVOICES.FINALIZE", "INVOICES.CANCEL"])
  viewer = await signIn(app, ["INVOICES.VIEW"])
  // Test rows' names and codes start with TEST-, so afterAll can remove them.
  const categoryId = (await db.category.create({ data: { name: `TEST-${stamp}` } })).id
  productId = (
    await db.product.create({
      data: {
        sku: `TEST-${stamp}`,
        title: `Test Product ${stamp}`,
        categoryId,
        warrantyMonths: 12,
        trackingType: "quantity",
        price: 1000,
        cost: 700,
        stockInHand: 5,
      },
    })
  ).id
  customerId = (await db.customer.create({ data: { code: `TEST-${stamp}`, type: "B2B", name: `Test Customer ${stamp}`, country: "LKA" } })).id
  const quotation = await db.quotation.create({
    data: {
      customerId,
      salesManagerId: user.id,
      quotationDate: new Date(),
      status: "paymentConfirmed",
      grandTotal: 2000,
      items: {
        create: {
          lineNo: 1,
          productId,
          description: "Test line",
          quantity: 2,
          unitPrice: 1000,
          unitCost: 700,
          subtotal: 2000,
          discountAmount: 0,
          taxAmount: 0,
          lineTotal: 2000,
        },
      },
    },
  })
  quotationId = quotation.id
})

afterAll(async () => {
  const units = { serialItem: { product: { sku: { startsWith: `TEST-${stamp}` } } } }
  await db.invoiceSerialItem.deleteMany({ where: { invoice: { customerId } } })
  await db.serialItemMovement.deleteMany({ where: units })
  await db.serialItem.deleteMany({ where: { product: { sku: { startsWith: `TEST-${stamp}` } } } })
  await db.deliveryNote.deleteMany({ where: { invoice: { customerId } } })
  await db.invoiceItem.deleteMany({ where: { invoice: { customerId } } })
  await db.invoice.deleteMany({ where: { customerId } })
  await db.quotationItem.deleteMany({ where: { quotation: { customerId } } })
  await db.quotation.deleteMany({ where: { customerId } })
  await db.stockMovement.deleteMany({ where: { product: { sku: { startsWith: `TEST-${stamp}` } } } })
  await db.customer.deleteMany({ where: { code: `TEST-${stamp}` } })
  await db.product.deleteMany({ where: { sku: { startsWith: `TEST-${stamp}` } } })
  await db.category.deleteMany({ where: { name: `TEST-${stamp}` } })
  await cleanupTestUsers()
  await app.close()
})

const post = (who: TestUser, url: string, payload: object = {}) =>
  app.inject({ method: "POST", url: `/api/v1/invoices${url}`, headers: { cookie: who.cookie }, payload })
const line = (quantity: number, unitPrice = 900) => ({ productId, quantity, unitPrice })
const stock = async () => db.product.findUniqueOrThrow({ where: { id: productId }, select: { stockInHand: true } })

describe("invoices", () => {
  let id: number

  it("needs INVOICES.CREATE", async () => {
    const res = await post(viewer, "", { quotationId, paymentMethod: "cash", dueDate: "2026-12-01", items: [line(2)] })
    expect(res.statusCode).toBe(403)
  })

  it("refuses more than the stock in hand", async () => {
    const res = await post(user, "", { quotationId, paymentMethod: "cash", dueDate: "2026-12-01", items: [line(6)] })
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toMatchObject({ code: "INSUFFICIENT_STOCK", details: { shortages: [{ productId, needed: 6, inHand: 5 }] } })
  })

  it("creates a draft from the quotation, with its own prices, and locks the quotation", async () => {
    const res = await post(user, "", { quotationId, paymentMethod: "cash", dueDate: "2026-12-01", items: [line(2)] })
    expect(res.statusCode).toBe(201)
    const invoice = res.json()
    id = invoice.id
    expect(invoice).toMatchObject({ status: "draft", invoiceNumber: null, customerId, salesManagerId: user.id, subtotal: 1800 })
    expect(invoice.draftNumber).toMatch(/^\d{2}[A-Z]{3}_[A-Z0-9]+_\d+-draft$/)
    expect(invoice.quotation).toMatchObject({ id: quotationId, items: [{ productId, unitPrice: 1000 }] })
    expect(invoice.items).toMatchObject([{ productId, unitPrice: 900, unitCost: 700 }])
    expect((await db.quotation.findUniqueOrThrow({ where: { id: quotationId } })).status).toBe("invoiceCreated")
  })

  it("allows one invoice per quotation", async () => {
    const res = await post(user, "", { quotationId, paymentMethod: "cash", dueDate: "2026-12-01", items: [line(1)] })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("INVOICE_EXISTS")
  })

  it("finalizes: numbers it and takes the stock out of stock in hand", async () => {
    const res = await post(user, `/${id}/finalize`)
    expect(res.statusCode).toBe(200)
    expect(res.json().invoiceNumber).toMatch(/^\d{2}[A-Z]{3}_[A-Z0-9]+_\d+$/)
    expect(await stock()).toEqual({ stockInHand: 3 })
    expect(res.json().deliveryNote).toMatchObject({ status: "draft", deliveryNoteNumber: expect.stringMatching(/^GPDN-d+$/) })
    const edit = await app.inject({ method: "PATCH", url: `/api/v1/invoices/${id}`, headers: { cookie: user.cookie }, payload: { notes: "x" } })
    expect(edit.json().error.code).toBe("INVOICE_NOT_DRAFT")
  })

  it("cancels: gives back the stock and the quotation's status", async () => {
    const res = await post(user, `/${id}/cancel`)
    expect(res.statusCode).toBe(200)
    expect(res.json().status).toBe("cancelledAfterFinalized")
    expect(res.json().deliveryNote.status).toBe("cancelled")
    expect(await stock()).toEqual({ stockInHand: 5 })
    expect((await db.quotation.findUniqueOrThrow({ where: { id: quotationId } })).status).toBe("paymentConfirmed")
  })
})

describe("serial numbers on invoices", () => {
  let serialProductId: string
  let id: number
  const serial = (n: number) => `TEST-INV-${stamp}-${n}`
  const scan = (code: string) => post(user, `/${id}/serials/scan`, { code })

  beforeAll(async () => {
    const product = await db.product.findUniqueOrThrow({ where: { id: productId }, select: { categoryId: true } })
    serialProductId = (
      await db.product.create({
        data: { sku: `TEST-${stamp}-SN`, title: "Inverter", categoryId: product.categoryId, warrantyMonths: 60, trackingType: "serial", price: 500, stockInHand: 3 },
      })
    ).id
    for (const n of [1, 2, 3]) {
      await db.serialItem.create({ data: { productId: serialProductId, serialNumber: serial(n), palletNumber: n < 3 ? `TEST-PAL-${stamp}` : null } })
    }
    const quotation = await db.quotation.create({
      data: { customerId, salesManagerId: user.id, quotationDate: new Date(), status: "paymentConfirmed", grandTotal: 1000 },
    })
    const draft = await post(user, "", {
      quotationId: quotation.id,
      paymentMethod: "cash",
      dueDate: "2026-12-01",
      items: [{ productId: serialProductId, quantity: 2, unitPrice: 500 }],
    })
    expect(draft.statusCode).toBe(201)
    id = draft.json().id
    expect(draft.json().items[0]).toMatchObject({ warrantyMonths: 60, warrantyEndsAt: null })
  })

  it("refuses to put a serial-tracked product on two lines", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/invoices/${id}`,
      headers: { cookie: user.cookie },
      payload: { items: [{ productId: serialProductId, quantity: 1 }, { productId: serialProductId, quantity: 1 }] },
    })
    expect(res.statusCode).toBe(400)
  })

  it("refuses to finalize before every unit is scanned", async () => {
    const res = await post(user, `/${id}/finalize`)
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toMatchObject({ code: "SERIALS_MISSING", details: { lines: [{ quantity: 2, scanned: 0 }] } })
  })

  it("scans a unit by its serial, ignoring case, and refuses it twice or an unknown code", async () => {
    const res = await scan(serial(1).toLowerCase())
    expect(res.json()).toEqual({ added: [{ serialItemId: expect.any(Number), serialNumber: serial(1), sku: `TEST-${stamp}-SN` }], skipped: 0 })
    expect((await scan(serial(1))).json().error.code).toBe("SERIAL_NOT_AVAILABLE")
    expect((await scan("TEST-NOPE")).json().error.code).toBe("SERIAL_NOT_FOUND")
  })

  it("scans a pallet: adds its units the line still needs, skips the rest", async () => {
    const res = await scan(`TEST-PAL-${stamp}`)
    expect(res.json()).toMatchObject({ added: [{ serialNumber: serial(2) }], skipped: 1 })
    expect((await scan(serial(3))).json().error.message).toMatch(/All 2 of/)
  })

  it("takes a wrong scan off again", async () => {
    const unit = await db.serialItem.findFirstOrThrow({ where: { serialNumber: serial(2) } })
    const res = await app.inject({ method: "DELETE", url: `/api/v1/invoices/${id}/serials/${unit.id}`, headers: { cookie: user.cookie } })
    expect(res.statusCode).toBe(204)
    expect((await scan(serial(3))).json().added).toHaveLength(1)
  })

  it("finalizes: sells the scanned units, takes the stock and starts the warranty", async () => {
    const res = await post(user, `/${id}/finalize`)
    expect(res.statusCode).toBe(200)
    expect(res.json().items[0].warrantyEndsAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(res.json().serialPicks.map((pick: { serialItem: { serialNumber: string } }) => pick.serialItem.serialNumber)).toEqual([serial(1), serial(3)])
    const units = await db.serialItem.findMany({ where: { productId: serialProductId }, orderBy: { serialNumber: "asc" } })
    expect(units.map((unit) => [unit.status, unit.invoiceId])).toEqual([["sold", id], ["inStock", null], ["sold", id]])
    expect((await db.product.findUniqueOrThrow({ where: { id: serialProductId } })).stockInHand).toBe(1)
  })

  it("cancels: the units go back into stock", async () => {
    const res = await post(user, `/${id}/cancel`)
    expect(res.json().serialPicks).toEqual([])
    expect(await db.serialItem.count({ where: { productId: serialProductId, status: "inStock" } })).toBe(3)
    expect((await db.product.findUniqueOrThrow({ where: { id: serialProductId } })).stockInHand).toBe(3)
  })
})
