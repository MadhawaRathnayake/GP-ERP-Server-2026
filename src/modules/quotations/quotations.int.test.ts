import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { App } from "#app.js"
import { db } from "#core/db.js"
import { cleanupTestUsers, keepUserDropdown, signIn, startApp, waitForChange, type TestUser } from "#test/helpers.js"
import { getSettings } from "#modules/settings/settings.service.js"

let app: App
let user: TestUser // every quotation permission
let seller: TestUser // view, create and edit, but no status changes
let noAccess: TestUser
let customerId: string
let productId: string
let vatRate: number
let restoreSalesManagers: () => Promise<void>
const stamp = Date.now()
const title = `Test Product ${stamp}`

beforeAll(async () => {
  app = await startApp()
  user = await signIn(app, [
    "QUOTATIONS.VIEW",
    "QUOTATIONS.CREATE",
    "QUOTATIONS.EDIT",
    "QUOTATIONS.DELETE",
    "QUOTATIONS.RESTORE",
    "QUOTATIONS.CONFIRM_PAYMENT",
    "QUOTATIONS.CONFIRM_CREDIT",
    "QUOTATIONS.UNDO_CONFIRMATION",
    "QUOTATIONS.CANCEL",
    "QUOTATIONS.REOPEN",
  ])
  seller = await signIn(app, ["QUOTATIONS.VIEW", "QUOTATIONS.CREATE", "QUOTATIONS.EDIT"])
  noAccess = await signIn(app, ["PRODUCTS.VIEW"])
  // Test rows' names and codes start with TEST-, so afterAll can remove them.
  const categoryId = (await db.category.create({ data: { name: `TEST-${stamp}` } })).id
  productId = (
    await db.product.create({
      data: { sku: `TEST-${stamp}`, title, categoryId, warrantyMonths: 12, trackingType: "quantity", price: 1000, cost: 700 },
    })
  ).id
  customerId = (await db.customer.create({ data: { code: `TEST-${stamp}`, type: "B2B", name: `Test Customer ${stamp}`, country: "Sri Lanka" } })).id
  vatRate = (await getSettings()).vatRate
  // Only user and seller can be picked as sales manager while this file runs; afterAll puts the real list back.
  restoreSalesManagers = await keepUserDropdown("SALES_MANAGER")
  const changed = waitForChange("UserDropdown") // so no cached sales manager list from before is served
  await db.userDropdown.upsert({
    where: { id: "SALES_MANAGER" },
    create: { id: "SALES_MANAGER", source: "users", userIds: [user.id, seller.id] },
    update: { source: "users", userIds: [user.id, seller.id] },
  })
  await changed
})

// Quotations first: their sales manager is a test user, and a user with quotations can't be removed.
afterAll(async () => {
  await db.quotationItem.deleteMany({ where: { quotation: { customerId } } })
  await db.quotation.deleteMany({ where: { customerId } })
  await restoreSalesManagers()
  await db.customer.deleteMany({ where: { code: `TEST-${stamp}` } })
  await db.product.deleteMany({ where: { sku: `TEST-${stamp}` } })
  await db.category.deleteMany({ where: { name: `TEST-${stamp}` } })
  await cleanupTestUsers()
  await app.close()
})

// The signed-in user is the sales manager unless the payload says otherwise.
const create = (who: TestUser, payload: object) =>
  app.inject({ method: "POST", url: "/api/v1/quotations", headers: { cookie: who.cookie }, payload: { salesManagerId: who.id, ...payload } })
const patch = (who: TestUser, id: number, payload: object) =>
  app.inject({ method: "PATCH", url: `/api/v1/quotations/${id}`, headers: { cookie: who.cookie }, payload })
const round2 = (n: number) => Math.round(n * 100) / 100

describe("quotations", () => {
  let id: number

  it("requires a session and QUOTATIONS.VIEW", async () => {
    expect((await app.inject({ url: "/api/v1/quotations" })).statusCode).toBe(401)
    expect((await app.inject({ url: "/api/v1/quotations", headers: { cookie: noAccess.cookie } })).statusCode).toBe(403)
  })

  it("offers the sales managers chosen in Admin → Dropdowns", async () => {
    const res = await app.inject({ url: "/api/v1/quotations/sales-managers", headers: { cookie: seller.cookie } })
    expect(res.statusCode).toBe(200)
    expect(res.json().map((manager: { id: string }) => manager.id).sort()).toEqual([user.id, seller.id].sort())
  })

  it("creates an active quotation and works out the amounts", async () => {
    const res = await create(user, {
      customerId,
      validUntil: "2099-12-31",
      items: [{ productId, quantity: 5, unitPrice: 950, discountType: "percentage", discountValue: 10 }],
    })
    expect(res.statusCode).toBe(201)
    const taxAmount = round2((4275 * vatRate) / 100)
    expect(res.json()).toMatchObject({
      customerId,
      customer: { id: customerId, code: `TEST-${stamp}` },
      salesManagerId: user.id,
      status: "active",
      validUntil: "2099-12-31",
      subtotal: 4750,
      discountTotal: 475,
      taxTotal: taxAmount,
      grandTotal: round2(4275 + taxAmount),
      createdBy: user.id,
      isDeleted: false,
    })
    expect(res.json().quotationDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(res.json().items).toEqual([
      expect.objectContaining({
        lineNo: 1,
        productId,
        product: { sku: `TEST-${stamp}`, description: "N/A", imageUrl: null },
        description: title,
        quantity: 5,
        unitPrice: 950,
        unitCost: 700,
        taxRate: vatRate,
        subtotal: 4750,
        discountAmount: 475,
        taxAmount,
      }),
    ])
    id = res.json().id
  })

  it("defaults the price to the product's and ignores amounts sent by the client", async () => {
    const res = await create(user, { customerId, grandTotal: 1, items: [{ productId, quantity: 1, unitCost: 1, subtotal: 1 }] })
    expect(res.statusCode).toBe(201)
    expect(res.json().subtotal).toBe(1000)
    expect(res.json().items[0]).toMatchObject({ unitPrice: 1000, unitCost: 700, subtotal: 1000 })
  })

  it.each([
    ["a discount over the line subtotal", { items: [{ productId, quantity: 1, discountType: "fixed", discountValue: 1001 }] }],
    ["a percentage over 100", { items: [{ productId, quantity: 1, discountType: "percentage", discountValue: 101 }] }],
    ["a discount value without a discount type", { items: [{ productId, quantity: 1, discountValue: 5 }] }],
    ["no lines", { items: [] }],
    ["validUntil before the quotation date", { quotationDate: "2026-11-04", validUntil: "2026-11-03", items: [{ productId, quantity: 1 }] }],
    ["an unknown product", { items: [{ productId: "PROD999999999", quantity: 1 }] }],
    ["a sales manager who isn't in the dropdown", { salesManagerId: "USER99999999", items: [{ productId, quantity: 1 }] }],
  ])("rejects %s", async (_, payload) => {
    const res = await create(user, { customerId, ...payload })
    expect(res.statusCode).toBe(400)
  })

  it("replaces the lines on edit and keeps the old ones as deleted rows", async () => {
    const res = await patch(user, id, { items: [{ productId, quantity: 2, description: "Two units" }] })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ subtotal: 2000, discountTotal: 0, modifiedBy: user.id })
    expect(res.json().items).toHaveLength(1)
    expect(res.json().items[0]).toMatchObject({ lineNo: 1, description: "Two units", quantity: 2 })
    expect(await db.quotationItem.count({ where: { quotationId: id, isDeleted: true } })).toBe(1)
  })

  it("needs each status change's own permission, not QUOTATIONS.EDIT", async () => {
    const res = await patch(seller, id, { status: "paymentConfirmed" })
    expect(res.statusCode).toBe(403)
    expect(res.json().error).toMatchObject({ code: "FORBIDDEN", details: { permission: "QUOTATIONS.CONFIRM_PAYMENT" } })
  })

  it("lets users set the status, but not invoiceCreated", async () => {
    expect((await patch(user, id, { status: "paymentConfirmed" })).json().status).toBe("paymentConfirmed")
    expect((await patch(user, id, { status: "invoiceCreated" })).statusCode).toBe(400)
  })

  it("remembers the confirmation a cancelled quotation had", async () => {
    expect((await patch(user, id, { status: "cancelled" })).json().status).toBe("cancelledAfterPayment")
    expect((await patch(user, id, { status: "cancelled" })).json().status).toBe("cancelledAfterPayment")
    expect((await patch(user, id, { status: "cancelledAfterCredit" })).statusCode).toBe(400)
    expect((await patch(user, id, { status: "paymentConfirmed" })).json().status).toBe("paymentConfirmed")
  })

  it("accepts the saved sales manager back unchanged after they leave the dropdown", async () => {
    const quotation = (await create(seller, { customerId, items: [{ productId, quantity: 1 }] })).json()
    await db.userDropdown.update({ where: { id: "SALES_MANAGER" }, data: { userIds: [user.id] } })
    const res = await patch(user, quotation.id, { salesManagerId: seller.id, notes: "Same manager" })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ salesManagerId: seller.id, notes: "Same manager" })
    await db.userDropdown.update({ where: { id: "SALES_MANAGER" }, data: { userIds: [user.id, seller.id] } })
  })

  it("only edits or deletes an active quotation, but its status can still change", async () => {
    const edit = await patch(user, id, { notes: "After confirming" })
    expect(edit.statusCode).toBe(409)
    expect(edit.json().error.code).toBe("QUOTATION_NOT_ACTIVE")
    const del = await app.inject({ method: "DELETE", url: `/api/v1/quotations/${id}`, headers: { cookie: user.cookie } })
    expect(del.statusCode).toBe(409)
    expect((await patch(user, id, { status: "active" })).json().status).toBe("active")
  })

  it("locks a quotation once it has an invoice", async () => {
    const locked = (await create(user, { customerId, items: [{ productId, quantity: 1 }] })).json().id
    await db.quotation.update({ where: { id: locked }, data: { status: "invoiceCreated" } })
    const edit = await patch(user, locked, { notes: "Too late" })
    expect(edit.statusCode).toBe(409)
    expect(edit.json().error.code).toBe("QUOTATION_INVOICED")
    const del = await app.inject({ method: "DELETE", url: `/api/v1/quotations/${locked}`, headers: { cookie: user.cookie } })
    expect(del.statusCode).toBe(409)
  })

  it("filters the list by customer", async () => {
    const res = await app.inject({ url: `/api/v1/quotations?customerId=${customerId}`, headers: { cookie: user.cookie } })
    expect(res.statusCode).toBe(200)
    expect(res.json().total).toBeGreaterThanOrEqual(1)
    expect(res.json().data.every((q: { customerId: string }) => q.customerId === customerId)).toBe(true)
    expect(res.json().data[0].items).toBeUndefined()
  })

  it("soft-deletes and restores", async () => {
    const changed = waitForChange("Quotation")
    const del = await app.inject({ method: "DELETE", url: `/api/v1/quotations/${id}`, headers: { cookie: user.cookie } })
    expect(del.statusCode).toBe(204)
    await changed
    const list = await app.inject({ url: `/api/v1/quotations?customerId=${customerId}`, headers: { cookie: user.cookie } })
    expect(list.json().data.some((q: { id: number }) => q.id === id)).toBe(false)
    const all = await app.inject({ url: `/api/v1/quotations?customerId=${customerId}&includeDeleted=true`, headers: { cookie: user.cookie } })
    expect(all.json().data.some((q: { id: number }) => q.id === id)).toBe(true)
    const restored = await patch(user, id, { isDeleted: false })
    expect(restored.json()).toMatchObject({ isDeleted: false, items: [expect.objectContaining({ quantity: 2 })] })
  })

  it("saves a service quotation's references and clears them when it becomes a sales quotation", async () => {
    const references = { repairReceiveNoteId: "RRN-1", oldInvoiceId: "INV-1", oldSerialNumberId: "SN-1" }
    const delivery = { paymentTerms: "advancePayment", deliveryLocation: "Colombo warehouse" }
    const created = await create(user, { customerId, type: "service", ...references, ...delivery, items: [{ productId, quantity: 1 }] })
    expect(created.statusCode).toBe(201)
    expect(created.json()).toMatchObject({ type: "service", ...references, ...delivery, troubleshootId: null, productModel: null })

    const id = created.json().id
    expect((await patch(user, id, { type: "sales" })).statusCode).toBe(400)
    const cleared = await patch(user, id, { type: "sales", repairReceiveNoteId: null, oldInvoiceId: null, oldSerialNumberId: null })
    expect(cleared.json()).toMatchObject({ type: "sales", repairReceiveNoteId: null, oldInvoiceId: null, oldSerialNumberId: null })
  })

  it("returns 404 for an unknown id", async () => {
    expect((await app.inject({ url: "/api/v1/quotations/999999999", headers: { cookie: user.cookie } })).statusCode).toBe(404)
  })
})
