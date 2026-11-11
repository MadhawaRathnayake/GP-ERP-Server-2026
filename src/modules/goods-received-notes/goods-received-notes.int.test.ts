import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { App } from "#app.js"
import { db } from "#core/db.js"
import { cleanupTestUsers, signIn, startApp, type TestUser } from "#test/helpers.js"

// Uses ERP-DB like every integration test, and also uses up IR, PO and GRN numbers. Changes the real
// INTERNAL_REQUISITIONS, PURCHASE_ORDERS and GOODS_RECEIVED_NOTES approval rules; afterAll puts them back.

const SCREENS = ["INTERNAL_REQUISITIONS", "PURCHASE_ORDERS", "GOODS_RECEIVED_NOTES"] as const

let app: App
let user: TestUser // every IR, PO and GRN permission
let supplierId: string
let productId: string
let otherProductId: string
let savedRules: Awaited<ReturnType<typeof db.approvalRule.findMany>>
const stamp = Date.now()

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
    "GOODS_RECEIVED_NOTES.EDIT",
    "GOODS_RECEIVED_NOTES.APPROVE",
    "GOODS_RECEIVED_NOTES.REJECT",
    "GOODS_RECEIVED_NOTES.CANCEL",
  ])
  savedRules = await db.approvalRule.findMany({ where: { id: { in: [...SCREENS] } } })
  // IRs and POs are approved on save, so each test starts from an approved order; GRNs need approval.
  await requireApproval("INTERNAL_REQUISITIONS", false)
  await requireApproval("PURCHASE_ORDERS", false)
  await requireApproval("GOODS_RECEIVED_NOTES", true)
  // Test rows' names and codes start with TEST-, so afterAll can remove them.
  const categoryId = (await db.category.create({ data: { name: `TEST-${stamp}` } })).id
  const product = (sku: string) =>
    db.product.create({ data: { sku, title: `Test Product ${sku}`, categoryId, warrantyMonths: 12, trackingType: "quantity" } })
  productId = (await product(`TEST-${stamp}`)).id
  otherProductId = (await product(`TEST-${stamp}-2`)).id
  supplierId = (await db.supplier.create({ data: { code: `TEST-${stamp}`, name: `Test Supplier ${stamp}`, country: "Sri Lanka" } })).id
})

afterAll(async () => {
  for (const screen of SCREENS) {
    const saved = savedRules.find((rule) => rule.id === screen)
    if (saved) await db.approvalRule.update({ where: { id: screen }, data: saved })
    else await db.approvalRule.deleteMany({ where: { id: screen } })
  }
  const byRequisition = { internalRequisition: { supplierId } }
  const ids = async <T extends { id: number }>(rows: Promise<T[]>) => (await rows).map((row) => row.id)
  const notes = await ids(db.goodsReceivedNote.findMany({ where: byRequisition, select: { id: true } }))
  const orders = await ids(db.purchaseOrder.findMany({ where: byRequisition, select: { id: true } }))
  const requisitions = await ids(db.internalRequisition.findMany({ where: { supplierId }, select: { id: true } }))
  await db.approval.deleteMany({ where: { screen: "GOODS_RECEIVED_NOTES", documentId: { in: notes } } })
  await db.approval.deleteMany({ where: { screen: "PURCHASE_ORDERS", documentId: { in: orders } } })
  await db.approval.deleteMany({ where: { screen: "INTERNAL_REQUISITIONS", documentId: { in: requisitions } } })
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

const requireApproval = (screen: (typeof SCREENS)[number], isRequired: boolean) =>
  db.approvalRule.upsert({ where: { id: screen }, create: { id: screen, isRequired }, update: { isRequired } })

const send = (method: "GET" | "POST" | "PATCH", url: string, payload?: object) =>
  app.inject({ method, url: `/api/v1${url}`, headers: { cookie: user.cookie }, ...(payload && { payload }) })

const stockInHand = async (id: string) => (await db.product.findUniqueOrThrow({ where: { id }, select: { stockInHand: true } })).stockInHand

/** An approved IR (international, or local with an approved PO for 8 and 4). Returns the IR's id and its PO's. */
async function approvedOrder(isInternational = false) {
  const items = [
    { productId, quantity: 8 },
    { productId: otherProductId, quantity: 4 },
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
const received = (first: number, second: number) => [
  { productId, receivedQuantity: first, remarks: first === 0 ? null : "Boxes intact" },
  { productId: otherProductId, receivedQuantity: second },
]

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
        { productId: otherProductId, orderedQuantity: 4, receivedQuantity: 0, outstandingQuantity: 4 },
      ],
      goodsReceivedNotes: [],
      blockedReason: null,
    })
  })

  it("refuses more than is outstanding, and a line missing", async () => {
    const tooMany = await send("POST", "/goods-received-notes", { internalRequisitionId: irId, items: received(9, 0) })
    expect(tooMany.statusCode).toBe(409)
    expect(tooMany.json().error.code).toBe("GOODS_RECEIVED_NOTE_QUANTITY")
    const missing = await send("POST", "/goods-received-notes", { internalRequisitionId: irId, items: [received(1, 0)[0]] })
    expect(missing.statusCode).toBe(400)
  })

  it("creates a pending GRN for part of the order, without moving stock", async () => {
    const res = await send("POST", "/goods-received-notes", { internalRequisitionId: irId, supplierInvoiceNumber: "INV-1", items: received(5, 0) })
    expect(res.statusCode).toBe(201)
    const grn = res.json()
    id = grn.id
    expect(grn.grnNumber).toMatch(/^GPGRN-\d{4,}$/)
    expect(grn).toMatchObject({
      status: "pending",
      supplierId,
      supplierInvoiceNumber: "INV-1",
      internalRequisition: { id: irId, purchaseOrder: { id: poId } },
      items: [
        { lineNo: 1, productId, orderedQuantity: 8, receivedQuantity: 5, remarks: "Boxes intact" },
        { lineNo: 2, productId: otherProductId, orderedQuantity: 4, receivedQuantity: 0, remarks: null },
      ],
    })
    expect(await stockInHand(productId)).toBe(0)
  })

  it("allows one open GRN per order", async () => {
    const res = await send("POST", "/goods-received-notes", { internalRequisitionId: irId, items: received(1, 0) })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("GOODS_RECEIVED_NOTE_SOURCE")
  })

  it("rejects, resubmits on edit, then approves into stock", async () => {
    expect((await send("POST", `/goods-received-notes/${id}/reject`, { reason: "Count again" })).json().status).toBe("rejected")
    const edited = await send("PATCH", `/goods-received-notes/${id}`, { items: received(6, 1) })
    expect(edited.json()).toMatchObject({ status: "pending", items: [{ receivedQuantity: 6 }, { receivedQuantity: 1 }] })
    const approved = await send("POST", `/goods-received-notes/${id}/approve`)
    expect(approved.json().approvals.map((a: { decision: string }) => a.decision)).toEqual(["rejected", "approved"])

    const grnNumber: string = approved.json().grnNumber
    expect(await stockInHand(productId)).toBe(6)
    expect(await stockInHand(otherProductId)).toBe(1)
    const movement = await db.stockMovement.findFirst({ where: { productId, reference: grnNumber } })
    expect(movement).toMatchObject({ bucket: "inHand", quantity: 6, balanceAfter: 6 })
    expect((await send("GET", `/purchase-orders/${poId}`)).json().status).toBe("approved")
    expect((await send("PATCH", `/goods-received-notes/${id}`, { supplierInvoiceNumber: null })).statusCode).toBe(409)
    expect((await send("POST", `/goods-received-notes/${id}/cancel`, { reason: "Late" })).statusCode).toBe(409)
  })

  it("refuses to cancel an order that has received goods", async () => {
    const res = await send("POST", `/purchase-orders/${poId}/cancel`, { reason: "Not needed" })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("GOODS_ALREADY_RECEIVED")
  })

  it("completes the PO when the rest arrives", async () => {
    const receipt = (await send("GET", `/goods-received-notes/orders/${irId}`)).json()
    expect(receipt.lines.map((line: { outstandingQuantity: number }) => line.outstandingQuantity)).toEqual([2, 3])
    const rest = (await send("POST", "/goods-received-notes", { internalRequisitionId: irId, items: received(2, 3) })).json()
    await send("POST", `/goods-received-notes/${rest.id}/approve`)
    expect((await send("GET", `/purchase-orders/${poId}`)).json().status).toBe("completed")
    const after = (await send("GET", `/goods-received-notes/orders/${irId}`)).json()
    expect(after.blockedReason).toEqual(expect.any(String))
    expect(after.goodsReceivedNotes).toHaveLength(2)
  })

  it("cancelling the IR cancels its open GRN", async () => {
    const order = await approvedOrder()
    const grn = (await send("POST", "/goods-received-notes", { internalRequisitionId: order.irId, items: received(1, 0) })).json()
    expect((await send("POST", `/internal-requisitions/${order.irId}/cancel`, { reason: "Duplicate" })).statusCode).toBe(200)
    expect((await send("GET", `/goods-received-notes/${grn.id}`)).json()).toMatchObject({ status: "cancelled", cancelReason: "Duplicate" })
  })

  it("receives an international IR, approved on save when GRNs don't need approval", async () => {
    const { irId: internationalId } = await approvedOrder(true)
    const before = await stockInHand(productId)
    await requireApproval("GOODS_RECEIVED_NOTES", false)
    try {
      const res = await send("POST", "/goods-received-notes", { internalRequisitionId: internationalId, items: received(8, 0) })
      expect(res.statusCode).toBe(201)
      expect(res.json()).toMatchObject({ status: "approved", internalRequisition: { purchaseOrder: null }, approvals: [{ isAutomatic: true }] })
      expect(await stockInHand(productId)).toBe(before + 8)
    } finally {
      await requireApproval("GOODS_RECEIVED_NOTES", true)
    }
  })

  it("lists and finds by GRN number", async () => {
    const { grnNumber } = await db.goodsReceivedNote.findUniqueOrThrow({ where: { id } })
    const res = await send("GET", `/goods-received-notes?q=${grnNumber}`)
    expect(res.statusCode).toBe(200)
    expect(res.json().data.map((grn: { id: number }) => grn.id)).toEqual([id])
  })
})
