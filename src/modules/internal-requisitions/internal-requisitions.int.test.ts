import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { App } from "#app.js"
import { db } from "#core/db.js"
import { cleanupTestUsers, signIn, startApp, type TestUser } from "#test/helpers.js"

// Uses ERP-DB like every integration test, and also uses up IR numbers (internal_requisition_number_seq). Changes the
// real INTERNAL_REQUISITIONS approval rule; afterAll puts it back.

let app: App
let user: TestUser // every internal requisition permission
let viewer: TestUser
let supplierId: string
let productId: string
let otherProductId: string
let savedRule: Awaited<ReturnType<typeof db.approvalRule.findUnique>>
const ids: number[] = []
const stamp = Date.now()

beforeAll(async () => {
  app = await startApp()
  user = await signIn(app, [
    "INTERNAL_REQUISITIONS.VIEW",
    "INTERNAL_REQUISITIONS.CREATE",
    "INTERNAL_REQUISITIONS.EDIT",
    "INTERNAL_REQUISITIONS.APPROVE",
    "INTERNAL_REQUISITIONS.REJECT",
    "INTERNAL_REQUISITIONS.CANCEL",
  ])
  viewer = await signIn(app, ["INTERNAL_REQUISITIONS.VIEW"])
  savedRule = await db.approvalRule.findUnique({ where: { id: "INTERNAL_REQUISITIONS" } })
  await requireApproval(true)
  // Test rows' names and codes start with TEST-, so afterAll can remove them.
  const categoryId = (await db.category.create({ data: { name: `TEST-${stamp}` } })).id
  const product = (sku: string) =>
    db.product.create({
      data: { sku, title: `Test Product ${sku}`, categoryId, warrantyMonths: 12, trackingType: "quantity", stockInHand: 3, minimumStock: 10 },
    })
  productId = (await product(`TEST-${stamp}`)).id
  otherProductId = (await product(`TEST-${stamp}-2`)).id
  supplierId = (await db.supplier.create({ data: { code: `TEST-${stamp}`, name: `Test Supplier ${stamp}`, country: "Sri Lanka" } })).id
})

afterAll(async () => {
  if (savedRule) await db.approvalRule.update({ where: { id: savedRule.id }, data: savedRule })
  else await db.approvalRule.deleteMany({ where: { id: "INTERNAL_REQUISITIONS" } })
  await db.approval.deleteMany({ where: { screen: "INTERNAL_REQUISITIONS", documentId: { in: ids } } })
  await db.internalRequisitionItem.deleteMany({ where: { internalRequisition: { supplierId } } })
  await db.internalRequisition.deleteMany({ where: { supplierId } })
  await db.supplier.deleteMany({ where: { code: `TEST-${stamp}` } })
  await db.product.deleteMany({ where: { sku: { startsWith: `TEST-${stamp}` } } })
  await db.category.deleteMany({ where: { name: `TEST-${stamp}` } })
  await cleanupTestUsers()
  await app.close()
})

const requireApproval = (isRequired: boolean) =>
  db.approvalRule.upsert({ where: { id: "INTERNAL_REQUISITIONS" }, create: { id: "INTERNAL_REQUISITIONS", isRequired }, update: { isRequired } })

const send = (who: TestUser, method: "POST" | "PATCH", url: string, payload: object = {}) =>
  app.inject({ method, url: `/api/v1/internal-requisitions${url}`, headers: { cookie: who.cookie }, payload })

async function create(payload: object = {}) {
  const res = await send(user, "POST", "", { supplierId, items: [{ productId, quantity: 20 }], ...payload })
  expect(res.statusCode).toBe(201)
  ids.push(res.json().id)
  return res.json()
}

describe("internal requisitions", () => {
  let id: number

  it("creates a pending IR with its number and the products' stock figures", async () => {
    const ir = await create({ eta: "2026-12-01" })
    id = ir.id
    expect(ir).toMatchObject({
      status: "pending",
      supplierId,
      isInternational: false,
      eta: "2026-12-01",
      createdBy: user.id,
      creator: { id: user.id },
      approvals: [],
      items: [{ lineNo: 1, productId, quantity: 20, stockInHand: 3, minimumStock: 10 }],
    })
    expect(ir.internalRequisitionNumber).toMatch(/^GPIR-\d{4,}$/)
  })

  it("refuses duplicate products, no lines, an unknown supplier, and users without INTERNAL_REQUISITIONS.CREATE", async () => {
    const twice = { supplierId, items: [{ productId, quantity: 1 }, { productId, quantity: 2 }] }
    expect((await send(user, "POST", "", twice)).statusCode).toBe(400)
    expect((await send(user, "POST", "", { supplierId, items: [] })).statusCode).toBe(400)
    expect((await send(user, "POST", "", { supplierId: "SUP99999999", items: [{ productId, quantity: 1 }] })).statusCode).toBe(400)
    expect((await send(viewer, "POST", "", { supplierId, items: [{ productId, quantity: 1 }] })).statusCode).toBe(403)
  })

  it("edits a pending IR, replacing its lines", async () => {
    const res = await send(user, "PATCH", `/${id}`, { items: [{ productId: otherProductId, quantity: 5 }, { productId, quantity: 7 }] })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ status: "pending", eta: "2026-12-01", modifiedBy: user.id })
    expect(res.json().items.map((item: { productId: string; quantity: number }) => [item.productId, item.quantity])).toEqual([
      [otherProductId, 5],
      [productId, 7],
    ])
  })

  it("rejects with a reason, then refuses to approve it", async () => {
    expect((await send(user, "POST", `/${id}/reject`, { reason: " " })).statusCode).toBe(400)
    const res = await send(user, "POST", `/${id}/reject`, { reason: "Wrong supplier" })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ status: "rejected", approvals: [{ decision: "rejected", reason: "Wrong supplier", creator: { id: user.id } }] })
    const approve = await send(user, "POST", `/${id}/approve`)
    expect(approve.statusCode).toBe(409)
    expect(approve.json().error.code).toBe("INTERNAL_REQUISITION_NOT_PENDING")
  })

  it("submits a rejected IR again when it's edited, then approves it", async () => {
    expect((await send(user, "PATCH", `/${id}`, { eta: null })).json()).toMatchObject({ status: "pending", eta: null })
    const res = await send(user, "POST", `/${id}/approve`)
    expect(res.statusCode).toBe(200)
    expect(res.json().status).toBe("approved")
    expect(res.json().approvals.map((a: { decision: string }) => a.decision)).toEqual(["rejected", "approved"])
  })

  it("doesn't edit an approved IR", async () => {
    const res = await send(user, "PATCH", `/${id}`, { isInternational: true })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("INTERNAL_REQUISITION_NOT_EDITABLE")
  })

  it("cancels an approved IR as cancelledAfterApproved, once", async () => {
    const res = await send(user, "POST", `/${id}/cancel`, { reason: "No longer needed" })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ status: "cancelledAfterApproved", cancelReason: "No longer needed", canceller: { id: user.id } })
    const again = await send(user, "POST", `/${id}/cancel`, { reason: "Again" })
    expect(again.statusCode).toBe(409)
    expect(again.json().error.code).toBe("INTERNAL_REQUISITION_CANCELLED")
  })

  it("cancels a pending IR as cancelled", async () => {
    const ir = await create()
    expect((await send(user, "POST", `/${ir.id}/cancel`, { reason: "Duplicate" })).json().status).toBe("cancelled")
  })

  it("approves on save when approval isn't required", async () => {
    await requireApproval(false)
    try {
      const ir = await create({ isInternational: true })
      expect(ir).toMatchObject({ status: "approved", isInternational: true, approvals: [{ decision: "approved", isAutomatic: true }] })
    } finally {
      await requireApproval(true)
    }
  })

  it("lists and finds by number or supplier", async () => {
    const { internalRequisitionNumber } = await db.internalRequisition.findUniqueOrThrow({ where: { id } })
    const byNumber = await app.inject({ url: `/api/v1/internal-requisitions?q=${internalRequisitionNumber}`, headers: { cookie: viewer.cookie } })
    expect(byNumber.statusCode).toBe(200)
    expect(byNumber.json().data.map((ir: { id: number }) => ir.id)).toContain(id)
    const bySupplier = await app.inject({ url: `/api/v1/internal-requisitions?supplierId=${supplierId}`, headers: { cookie: viewer.cookie } })
    expect(bySupplier.json().total).toBe(ids.length)
  })
})
