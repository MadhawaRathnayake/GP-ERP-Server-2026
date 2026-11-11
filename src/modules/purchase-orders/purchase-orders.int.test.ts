import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { App } from "#app.js"
import { db } from "#core/db.js"
import { cleanupTestUsers, signIn, startApp, type TestUser } from "#test/helpers.js"

// Uses ERP-DB like every integration test, and also uses up IR and PO numbers. Changes the real INTERNAL_REQUISITIONS
// and PURCHASE_ORDERS approval rules; afterAll puts them back.

const SCREENS = ["INTERNAL_REQUISITIONS", "PURCHASE_ORDERS"] as const

let app: App
let user: TestUser // every IR and PO permission
let creatorOnly: TestUser // PURCHASE_ORDERS.CREATE without INTERNAL_REQUISITIONS.APPROVE
let supplierId: string
let otherSupplierId: string
let productId: string
let otherProductId: string
let strangerProductId: string
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
    "PURCHASE_ORDERS.EDIT",
    "PURCHASE_ORDERS.APPROVE",
    "PURCHASE_ORDERS.REJECT",
    "PURCHASE_ORDERS.CANCEL",
  ])
  creatorOnly = await signIn(app, ["PURCHASE_ORDERS.CREATE"])
  savedRules = await db.approvalRule.findMany({ where: { id: { in: [...SCREENS] } } })
  for (const screen of SCREENS) await requireApproval(screen, true)
  // Test rows' names and codes start with TEST-, so afterAll can remove them.
  const categoryId = (await db.category.create({ data: { name: `TEST-${stamp}` } })).id
  const product = (sku: string) =>
    db.product.create({ data: { sku, title: `Test Product ${sku}`, categoryId, warrantyMonths: 12, trackingType: "quantity" } })
  productId = (await product(`TEST-${stamp}`)).id
  otherProductId = (await product(`TEST-${stamp}-2`)).id
  strangerProductId = (await product(`TEST-${stamp}-3`)).id
  const supplier = (code: string) => db.supplier.create({ data: { code, name: `Test Supplier ${code}`, country: "Sri Lanka" } })
  supplierId = (await supplier(`TEST-${stamp}`)).id
  otherSupplierId = (await supplier(`TEST-${stamp}-2`)).id
})

afterAll(async () => {
  for (const screen of SCREENS) {
    const saved = savedRules.find((rule) => rule.id === screen)
    if (saved) await db.approvalRule.update({ where: { id: screen }, data: saved })
    else await db.approvalRule.deleteMany({ where: { id: screen } })
  }
  const orders = await db.purchaseOrder.findMany({ where: { internalRequisition: { supplierId } }, select: { id: true } })
  const requisitions = await db.internalRequisition.findMany({ where: { supplierId }, select: { id: true } })
  await db.approval.deleteMany({ where: { screen: "PURCHASE_ORDERS", documentId: { in: orders.map((o) => o.id) } } })
  await db.approval.deleteMany({ where: { screen: "INTERNAL_REQUISITIONS", documentId: { in: requisitions.map((r) => r.id) } } })
  await db.purchaseOrderItem.deleteMany({ where: { purchaseOrder: { internalRequisition: { supplierId } } } })
  await db.purchaseOrder.deleteMany({ where: { internalRequisition: { supplierId } } })
  await db.internalRequisitionItem.deleteMany({ where: { internalRequisition: { supplierId } } })
  await db.internalRequisition.deleteMany({ where: { supplierId } })
  await db.supplier.deleteMany({ where: { code: { startsWith: `TEST-${stamp}` } } })
  await db.product.deleteMany({ where: { sku: { startsWith: `TEST-${stamp}` } } })
  await db.category.deleteMany({ where: { name: `TEST-${stamp}` } })
  await cleanupTestUsers()
  await app.close()
})

const requireApproval = (screen: (typeof SCREENS)[number], isRequired: boolean) =>
  db.approvalRule.upsert({ where: { id: screen }, create: { id: screen, isRequired }, update: { isRequired } })

const send = (who: TestUser, method: "GET" | "POST" | "PATCH", url: string, payload?: object) =>
  app.inject({ method, url: `/api/v1${url}`, headers: { cookie: who.cookie }, ...(payload && { payload }) })

async function requisition(payload: object = {}) {
  const items = [
    { productId, quantity: 10 },
    { productId: otherProductId, quantity: 4 },
  ]
  const res = await send(user, "POST", "/internal-requisitions", { supplierId, items, ...payload })
  expect(res.statusCode).toBe(201)
  return res.json() as { id: number; status: string }
}

// A function: the product ids are set in beforeAll.
const lines = () => [
  { productId, quantity: 8, unitPrice: 1000, discountType: "percentage", discountValue: 10 },
  { productId: otherProductId, quantity: 4, unitPrice: 250.5 },
]

describe("purchase orders", () => {
  let irId: number
  let id: number

  it("refuses to approve a pending IR without INTERNAL_REQUISITIONS.APPROVE", async () => {
    irId = (await requisition()).id
    const res = await send(creatorOnly, "POST", "/purchase-orders", { internalRequisitionId: irId, supplierId, items: lines() })
    expect(res.statusCode).toBe(403)
  })

  it("refuses a product that isn't on the IR", async () => {
    const items = [{ productId: strangerProductId, quantity: 1, unitPrice: 5 }]
    expect((await send(user, "POST", "/purchase-orders", { internalRequisitionId: irId, supplierId, items })).statusCode).toBe(400)
  })

  it("approves the pending IR and creates a pending PO with the server's amounts", async () => {
    const res = await send(user, "POST", "/purchase-orders", { internalRequisitionId: irId, supplierId, items: lines(), comments: "Deliver by Friday" })
    expect(res.statusCode).toBe(201)
    const po = res.json()
    id = po.id
    expect(po.purchaseOrderNumber).toMatch(/^GPPO-\d{4,}$/)
    expect(po).toMatchObject({ status: "pending", internalRequisitionId: irId, comments: "Deliver by Friday", remarks: null, approvals: [] })
    expect(po.items[0]).toMatchObject({ lineNo: 1, quantity: 8, subtotal: 8000, discountAmount: 800 })
    expect(po.subtotal).toBe(9002)
    expect(po.discountTotal).toBe(800)
    expect(po.grandTotal).toBe(po.subtotal - po.discountTotal + po.taxTotal)

    const ir = (await send(user, "GET", `/internal-requisitions/${irId}`)).json()
    expect(ir).toMatchObject({ status: "approved", purchaseOrder: { id, status: "pending" }, approvals: [{ decision: "approved" }] })
  })

  it("refuses a second PO for the same IR", async () => {
    const res = await send(user, "POST", "/purchase-orders", { internalRequisitionId: irId, supplierId, items: lines() })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("PURCHASE_ORDER_SOURCE")
  })

  it("refuses an international IR", async () => {
    const international = await requisition({ isInternational: true })
    const res = await send(user, "POST", "/purchase-orders", { internalRequisitionId: international.id, supplierId, items: lines() })
    expect(res.statusCode).toBe(409)
  })

  it("rejects, then resubmits on edit, then approves", async () => {
    expect((await send(user, "POST", `/purchase-orders/${id}/reject`, { reason: "Price too high" })).json().status).toBe("rejected")
    const edited = await send(user, "PATCH", `/purchase-orders/${id}`, { supplierId: otherSupplierId, items: [lines()[1]] })
    expect(edited.statusCode).toBe(200)
    expect(edited.json()).toMatchObject({ status: "pending", supplierId: otherSupplierId, items: [{ productId: otherProductId }] })
    const approved = await send(user, "POST", `/purchase-orders/${id}/approve`)
    expect(approved.json().approvals.map((a: { decision: string }) => a.decision)).toEqual(["rejected", "approved"])
    const edit = await send(user, "PATCH", `/purchase-orders/${id}`, { comments: null })
    expect(edit.statusCode).toBe(409)
    expect(edit.json().error.code).toBe("PURCHASE_ORDER_NOT_EDITABLE")
  })

  it("cancels an approved PO and its IR, once", async () => {
    const res = await send(user, "POST", `/purchase-orders/${id}/cancel`, { reason: "Supplier closed" })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ status: "cancelledAfterApproved", cancelReason: "Supplier closed" })
    const ir = (await send(user, "GET", `/internal-requisitions/${irId}`)).json()
    expect(ir).toMatchObject({ status: "cancelledAfterApproved", cancelReason: "Supplier closed" })
    expect((await send(user, "POST", `/purchase-orders/${id}/cancel`, { reason: "Again" })).statusCode).toBe(409)
  })

  it("cancelling the IR cancels its pending PO", async () => {
    const ir = await requisition()
    const po = (await send(user, "POST", "/purchase-orders", { internalRequisitionId: ir.id, supplierId, items: lines() })).json()
    expect((await send(user, "POST", `/internal-requisitions/${ir.id}/cancel`, { reason: "Duplicate" })).statusCode).toBe(200)
    expect((await send(user, "GET", `/purchase-orders/${po.id}`)).json()).toMatchObject({ status: "cancelled", cancelReason: "Duplicate" })
  })

  it("orders an IR approved on save, and approves the PO on save when approval isn't required", async () => {
    await requireApproval("INTERNAL_REQUISITIONS", false)
    await requireApproval("PURCHASE_ORDERS", false)
    try {
      const ir = await requisition()
      expect(ir.status).toBe("approved")
      const res = await send(creatorOnly, "POST", "/purchase-orders", { internalRequisitionId: ir.id, supplierId, items: lines() })
      expect(res.statusCode).toBe(201)
      expect(res.json()).toMatchObject({ status: "approved", approvals: [{ decision: "approved", isAutomatic: true }] })
    } finally {
      await requireApproval("INTERNAL_REQUISITIONS", true)
      await requireApproval("PURCHASE_ORDERS", true)
    }
  })

  it("lists and finds by PO or IR number", async () => {
    const { purchaseOrderNumber } = await db.purchaseOrder.findUniqueOrThrow({ where: { id } })
    const res = await send(user, "GET", `/purchase-orders?q=${purchaseOrderNumber}`)
    expect(res.statusCode).toBe(200)
    expect(res.json().data.map((po: { id: number }) => po.id)).toEqual([id])
  })
})
