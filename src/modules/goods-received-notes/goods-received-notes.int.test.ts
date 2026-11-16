import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { App } from "#app.js"
import { db } from "#core/db.js"
import { cleanupTestUsers, signIn, startApp, type TestUser } from "#test/helpers.js"

// Uses ERP-DB like every integration test, and also uses up IR, PO and GRN numbers. Changes the real
// INTERNAL_REQUISITIONS and PURCHASE_ORDERS approval rules; afterAll puts them back.

const SCREENS = ["INTERNAL_REQUISITIONS", "PURCHASE_ORDERS"] as const

let app: App
let user: TestUser // every IR, PO and GRN permission
let supplierId: string
let productId: string // counted by quantity
let serialProductId: string // tracked by serial number
let savedRules: Awaited<ReturnType<typeof db.approvalRule.findMany>>
const stamp = Date.now()
const serial = (n: number) => `TEST-GRN-${stamp}-${n}`

beforeAll(async () => {
  app = await startApp()
  user = await signIn(app, [
    "INTERNAL_REQUISITIONS.VIEW",
    "INTERNAL_REQUISITIONS.CREATE",
    "INTERNAL_REQUISITIONS.APPROVE",
    "INTERNAL_REQUISITIONS.CANCEL",
    "PURCHASE_ORDERS.VIEW",
    "PURCHASE_ORDERS.CREATE",
    "PURCHASE_ORDERS.CANCEL",
    "GOODS_RECEIVED_NOTES.VIEW",
    "GOODS_RECEIVED_NOTES.CREATE",
    "GOODS_RECEIVED_NOTES.ADD_SERIALS",
  ])
  savedRules = await db.approvalRule.findMany({ where: { id: { in: [...SCREENS] } } })
  // IRs and POs are approved on save, so each test starts from an approved order.
  for (const screen of SCREENS) {
    await db.approvalRule.upsert({ where: { id: screen }, create: { id: screen, isRequired: false }, update: { isRequired: false } })
  }
  // Test rows' names and codes start with TEST-, so afterAll can remove them.
  const categoryId = (await db.category.create({ data: { name: `TEST-${stamp}` } })).id
  const product = (sku: string, trackingType: "quantity" | "serial") =>
    db.product.create({ data: { sku, title: `Test Product ${sku}`, categoryId, warrantyMonths: 12, trackingType } })
  productId = (await product(`TEST-${stamp}`, "quantity")).id
  serialProductId = (await product(`TEST-${stamp}-SN`, "serial")).id
  supplierId = (await db.supplier.create({ data: { code: `TEST-${stamp}`, name: `Test Supplier ${stamp}`, country: "LKA" } })).id
})

afterAll(async () => {
  for (const screen of SCREENS) {
    const saved = savedRules.find((rule) => rule.id === screen)
    if (saved) await db.approvalRule.update({ where: { id: screen }, data: saved })
    else await db.approvalRule.deleteMany({ where: { id: screen } })
  }
  const byRequisition = { internalRequisition: { supplierId } }
  const ids = async <T extends { id: number }>(rows: Promise<T[]>) => (await rows).map((row) => row.id)
  const orders = await ids(db.purchaseOrder.findMany({ where: byRequisition, select: { id: true } }))
  const requisitions = await ids(db.internalRequisition.findMany({ where: { supplierId }, select: { id: true } }))
  const units = { serialItem: { productId: serialProductId } }
  await db.serialItemMovement.deleteMany({ where: units })
  await db.serialItemAccessory.deleteMany({ where: units })
  await db.serialItem.deleteMany({ where: { productId: serialProductId } })
  await db.approval.deleteMany({ where: { screen: "PURCHASE_ORDERS", documentId: { in: orders } } })
  await db.approval.deleteMany({ where: { screen: "INTERNAL_REQUISITIONS", documentId: { in: requisitions } } })
  await db.goodsReceivedNoteDeliveryItem.deleteMany({ where: { delivery: { goodsReceivedNote: byRequisition } } })
  await db.goodsReceivedNoteDelivery.deleteMany({ where: { goodsReceivedNote: byRequisition } })
  await db.goodsReceivedNoteItem.deleteMany({ where: { goodsReceivedNote: byRequisition } })
  await db.goodsReceivedNote.deleteMany({ where: byRequisition })
  await db.purchaseOrderItem.deleteMany({ where: { purchaseOrder: byRequisition } })
  await db.purchaseOrder.deleteMany({ where: byRequisition })
  await db.internalRequisitionItem.deleteMany({ where: { internalRequisition: { supplierId } } })
  await db.internalRequisition.deleteMany({ where: { supplierId } })
  await db.stockMovement.deleteMany({ where: { product: { sku: { startsWith: `TEST-${stamp}` } } } })
  await db.supplier.deleteMany({ where: { code: `TEST-${stamp}` } })
  await db.product.deleteMany({ where: { sku: { startsWith: `TEST-${stamp}` } } })
  await db.category.deleteMany({ where: { name: `TEST-${stamp}` } })
  await cleanupTestUsers()
  await app.close()
})

const send = (method: "GET" | "POST", url: string, payload?: object) =>
  app.inject({ method, url: `/api/v1${url}`, headers: { cookie: user.cookie }, ...(payload && { payload }) })

const stockInHand = async (id: string) => (await db.product.findUniqueOrThrow({ where: { id }, select: { stockInHand: true } })).stockInHand

/** An approved IR (international, or local with an approved PO) for 8 of the counted product and 3 serial ones. */
async function approvedOrder(isInternational = false) {
  const items = [
    { productId, quantity: 8 },
    { productId: serialProductId, quantity: 3 },
  ]
  const ir = await send("POST", "/internal-requisitions", { supplierId, isInternational, items })
  expect(ir.json().status).toBe("approved")
  const irId: number = ir.json().id
  if (isInternational) return { irId, poId: null }
  const lines = items.map((item) => ({ ...item, unitPrice: 100 }))
  const po = await send("POST", "/purchase-orders", { internalRequisitionId: irId, supplierId, items: lines })
  expect(po.json().status).toBe("approved")
  return { irId, poId: po.json().id as number }
}

// A function: the product ids are set in beforeAll.
const delivery = (counted: number, serials: number, more: object = {}) => ({
  supplierInvoiceNumber: "INV-1",
  items: [
    { productId, quantity: counted, remarks: counted === 0 ? null : "Boxes intact" },
    { productId: serialProductId, quantity: serials },
  ],
  ...more,
})

describe("goods received notes", () => {
  let irId: number
  let poId: number | null
  let id: number

  it("shows what the order has outstanding", async () => {
    const order = await approvedOrder()
    irId = order.irId
    poId = order.poId
    const res = await send("GET", `/goods-received-notes/orders/${irId}`)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      purchaseOrder: { id: poId, status: "approved" },
      lines: [
        { productId, orderedQuantity: 8, receivedQuantity: 0, outstandingQuantity: 8 },
        { productId: serialProductId, orderedQuantity: 3, receivedQuantity: 0, outstandingQuantity: 3 },
      ],
      goodsReceivedNote: null,
      blockedReason: null,
    })
  })

  it("refuses more than is outstanding", async () => {
    const res = await send("POST", "/goods-received-notes", { internalRequisitionId: irId, ...delivery(9, 0) })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("GOODS_RECEIVED_NOTE_QUANTITY")
  })

  it("records the first delivery: makes the GRN and puts counted goods in stock at once", async () => {
    const res = await send("POST", "/goods-received-notes", { internalRequisitionId: irId, receivedDate: "2026-11-10", ...delivery(5, 2) })
    expect(res.statusCode).toBe(201)
    id = res.json().id
    expect(res.json()).toMatchObject({
      grnNumber: expect.stringMatching(/^GPGRN-\d{4,}$/),
      status: "needSerialNumbers",
      items: [
        { productId, orderedQuantity: 8, receivedQuantity: 5, outstandingQuantity: 3, serialsMissing: 0 },
        { productId: serialProductId, orderedQuantity: 3, receivedQuantity: 2, outstandingQuantity: 1, serialsEntered: 0, serialsMissing: 2 },
      ],
      deliveries: [{ deliveryNo: 1, receivedDate: "2026-11-10", supplierInvoiceNumber: "INV-1", items: [{ productId, quantity: 5 }, { productId: serialProductId, quantity: 2 }] }],
    })
    expect(await stockInHand(productId)).toBe(5)
    // Serial goods wait for their serials.
    expect(await stockInHand(serialProductId)).toBe(0)
    const movement = await db.stockMovement.findFirstOrThrow({ where: { productId } })
    expect(movement).toMatchObject({ quantity: 5, balanceAfter: 5, reference: res.json().grnNumber })
  })

  it("allows one GRN per order", async () => {
    const res = await send("POST", "/goods-received-notes", { internalRequisitionId: irId, ...delivery(1, 0) })
    expect(res.json().error.code).toBe("GOODS_RECEIVED_NOTE_SOURCE")
  })

  it("adds serials: each unit goes into stock; refuses more than are missing", async () => {
    const tooMany = await send("POST", `/goods-received-notes/${id}/serials`, {
      productId: serialProductId,
      units: [{ serialNumber: serial(1) }, { serialNumber: serial(2) }, { serialNumber: serial(3) }],
    })
    expect(tooMany.json().error.code).toBe("GOODS_RECEIVED_NOTE_SERIALS")

    const res = await send("POST", `/goods-received-notes/${id}/serials`, {
      productId: serialProductId,
      units: [{ serialNumber: serial(1) }, { serialNumber: serial(2) }],
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ status: "partiallyCompleted", items: [{}, { serialsEntered: 2, serialsMissing: 0 }] })
    expect(await stockInHand(serialProductId)).toBe(2)
    const unit = await db.serialItem.findFirstOrThrow({ where: { serialNumber: serial(1) }, include: { goodsReceivedNoteDelivery: true } })
    expect(unit).toMatchObject({ status: "inStock", goodsReceivedNoteDelivery: { goodsReceivedNoteId: id, deliveryNo: 1 } })
  })

  it("refuses serials for a counted line", async () => {
    const res = await send("POST", `/goods-received-notes/${id}/serials`, { productId, units: [{ serialNumber: serial(9) }] })
    expect(res.json().error.code).toBe("GOODS_RECEIVED_NOTE_SERIALS")
  })

  it("refuses to cancel the order once goods have arrived", async () => {
    const res = await send("POST", `/purchase-orders/${poId}/cancel`, { reason: "Changed our mind" })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("GOODS_ALREADY_RECEIVED")
  })

  it("records the rest in a later delivery, and completes once the serials are in", async () => {
    const res = await send("POST", `/goods-received-notes/${id}/deliveries`, delivery(3, 1, { supplierInvoiceNumber: "INV-2" }))
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ status: "needSerialNumbers", deliveries: [{ deliveryNo: 1 }, { deliveryNo: 2 }] })
    expect(await stockInHand(productId)).toBe(8)
    expect((await db.purchaseOrder.findUniqueOrThrow({ where: { id: poId! } })).status).toBe("completed")

    const done = await send("POST", `/goods-received-notes/${id}/serials`, { productId: serialProductId, units: [{ serialNumber: serial(3) }] })
    expect(done.json().status).toBe("completed")
    expect(await stockInHand(serialProductId)).toBe(3)
    const unit = await db.serialItem.findFirstOrThrow({ where: { serialNumber: serial(3) }, include: { goodsReceivedNoteDelivery: true } })
    expect(unit.goodsReceivedNoteDelivery?.deliveryNo).toBe(2)
  })

  it("refuses a delivery once everything has arrived", async () => {
    const res = await send("POST", `/goods-received-notes/${id}/deliveries`, delivery(1, 0))
    expect(res.json().error.code).toBe("GOODS_RECEIVED_NOTE_SOURCE")
    const order = await send("GET", `/goods-received-notes/orders/${irId}`)
    expect(order.json()).toMatchObject({ goodsReceivedNote: { id, status: "completed" }, blockedReason: expect.any(String) })
  })

  it("lists and finds a GRN by a supplier invoice number", async () => {
    const res = await send("GET", `/goods-received-notes?q=INV-2&supplierId=${supplierId}`)
    expect(res.json()).toMatchObject({ total: 1, data: [{ id, status: "completed" }] })
  })

  it("receives an approved international IR, which has no PO", async () => {
    const order = await approvedOrder(true)
    const res = await send("POST", "/goods-received-notes", { internalRequisitionId: order.irId, ...delivery(8, 0) })
    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ status: "partiallyCompleted", internalRequisition: { isInternational: true, purchaseOrder: null } })
  })
})
