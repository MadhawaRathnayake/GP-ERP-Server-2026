import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { App } from "#app.js"
import { db } from "#core/db.js"
import { cleanupTestUsers, signIn, startApp, type TestUser } from "#test/helpers.js"

// Uses ERP-DB like every integration test, and also uses up this month's invoice numbers (InvoiceNumberCounter).

let app: App
let user: TestUser // every invoice permission
let viewer: TestUser
let customerId: string
let productId: string
let quotationId: number
const stamp = Date.now()

beforeAll(async () => {
  app = await startApp()
  user = await signIn(app, ["INVOICES.VIEW", "INVOICES.CREATE", "INVOICES.EDIT", "INVOICES.FINALIZE", "INVOICES.CANCEL"])
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
  customerId = (await db.customer.create({ data: { code: `TEST-${stamp}`, type: "B2B", name: `Test Customer ${stamp}`, country: "Sri Lanka" } })).id
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
  await db.invoiceItem.deleteMany({ where: { invoice: { customerId } } })
  await db.invoice.deleteMany({ where: { customerId } })
  await db.quotationItem.deleteMany({ where: { quotation: { customerId } } })
  await db.quotation.deleteMany({ where: { customerId } })
  await db.stockMovement.deleteMany({ where: { productId } })
  await db.customer.deleteMany({ where: { code: `TEST-${stamp}` } })
  await db.product.deleteMany({ where: { sku: `TEST-${stamp}` } })
  await db.category.deleteMany({ where: { name: `TEST-${stamp}` } })
  await cleanupTestUsers()
  await app.close()
})

const post = (who: TestUser, url: string, payload: object = {}) =>
  app.inject({ method: "POST", url: `/api/v1/invoices${url}`, headers: { cookie: who.cookie }, payload })
const line = (quantity: number, unitPrice = 900) => ({ productId, quantity, unitPrice })
const stock = async () => db.product.findUniqueOrThrow({ where: { id: productId }, select: { stockInHand: true, stockInTransit: true } })

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

  it("finalizes: numbers it and moves the stock in hand to in transit", async () => {
    const res = await post(user, `/${id}/finalize`)
    expect(res.statusCode).toBe(200)
    expect(res.json().invoiceNumber).toMatch(/^\d{2}[A-Z]{3}_[A-Z0-9]+_\d+$/)
    expect(await stock()).toEqual({ stockInHand: 3, stockInTransit: 2 })
    const edit = await app.inject({ method: "PATCH", url: `/api/v1/invoices/${id}`, headers: { cookie: user.cookie }, payload: { notes: "x" } })
    expect(edit.json().error.code).toBe("INVOICE_NOT_DRAFT")
  })

  it("cancels: gives back the stock and the quotation's status", async () => {
    const res = await post(user, `/${id}/cancel`)
    expect(res.statusCode).toBe(200)
    expect(res.json().status).toBe("cancelled")
    expect(await stock()).toEqual({ stockInHand: 5, stockInTransit: 0 })
    expect((await db.quotation.findUniqueOrThrow({ where: { id: quotationId } })).status).toBe("paymentConfirmed")
  })
})
