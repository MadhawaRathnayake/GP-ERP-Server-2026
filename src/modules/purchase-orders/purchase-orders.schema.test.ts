import { describe, expect, it } from "vitest"
import { createPurchaseOrderBody, updatePurchaseOrderBody } from "./purchase-orders.schema.js"

const base = { internalRequisitionId: 1, supplierId: "SUP00001" }
const line = (productId: string, more: object = {}) => ({ productId, quantity: 1, unitPrice: 100, ...more })

describe("createPurchaseOrderBody", () => {
  it("defaults to no comments, no remarks, no discount and no date (today)", () => {
    const body = createPurchaseOrderBody.parse({ ...base, items: [line("PROD000001")] })
    expect(body).toMatchObject({ comments: null, remarks: null, items: [{ discountType: "none" }] })
    expect(body.purchaseOrderDate).toBeUndefined()
    expect(body.items[0]?.discountValue.isZero()).toBe(true)
  })

  it.each([
    ["no lines", { ...base, items: [] }],
    ["a product twice", { ...base, items: [line("PROD000001"), line("PROD000001")] }],
    ["a quantity of 0", { ...base, items: [line("PROD000001", { quantity: 0 })] }],
    ["a unit price of 0", { ...base, items: [line("PROD000001", { unitPrice: 0 })] }],
    ["a discount with type none", { ...base, items: [line("PROD000001", { discountValue: 5 })] }],
    ["a percentage over 100", { ...base, items: [line("PROD000001", { discountType: "percentage", discountValue: 101 })] }],
    ["no internal requisition", { supplierId: "SUP00001", items: [line("PROD000001")] }],
  ])("rejects %s", (_, body) => {
    expect(createPurchaseOrderBody.safeParse(body).success).toBe(false)
  })
})

describe("updatePurchaseOrderBody", () => {
  it("keeps fields that aren't sent", () => {
    expect(updatePurchaseOrderBody.parse({ purchaseOrderDate: "2026-12-01" })).toEqual({ purchaseOrderDate: new Date("2026-12-01T00:00:00.000Z") })
  })
})
