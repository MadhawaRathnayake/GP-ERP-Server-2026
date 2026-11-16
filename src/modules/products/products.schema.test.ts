import { describe, expect, it } from "vitest"
import { createProductBody, stockAdjustmentBody, updateProductBody } from "./products.schema.js"

const required = { sku: "A", title: "A", categoryId: "CAT0001", warrantyMonths: 12, trackingType: "quantity" }

describe("product bodies", () => {
  it("fills defaults on create", () => {
    const body = createProductBody.parse(required)
    expect(body).toMatchObject({ description: null, minimumStock: 0, additionalInfo: null })
    expect(body.price.toNumber()).toBe(0)
    expect(body.cost.toNumber()).toBe(0)
  })

  it("rejects a negative price", () => {
    expect(createProductBody.safeParse({ ...required, price: -1 }).success).toBe(false)
  })

  it("doesn't take stock: it changes through documents and stock adjustments only", () => {
    expect(createProductBody.parse({ ...required, stockInHand: 5 })).not.toHaveProperty("stockInHand")
    expect(updateProductBody.parse({ stockInHand: 5 })).toEqual({})
  })

  it("leaves fields that a PATCH doesn't send untouched", () => {
    expect(updateProductBody.parse({ title: "Renamed" })).toEqual({ title: "Renamed" })
  })
})

describe("stock adjustment body", () => {
  it("takes a signed whole quantity and a reason", () => {
    expect(stockAdjustmentBody.parse({ quantity: -3, reason: " Count " })).toEqual({ quantity: -3, reason: "Count" })
  })

  it("takes units with trimmed serials, default pallet and accessories", () => {
    expect(stockAdjustmentBody.parse({ reason: "Count", add: [{ serialNumber: " ab-12 " }] })).toEqual({
      reason: "Count",
      add: [{ serialNumber: "ab-12", palletNumber: null, accessories: [] }],
    })
  })

  it.each([
    ["0", { quantity: 0, reason: "Count" }],
    ["a fraction", { quantity: 1.5, reason: "Count" }],
    ["no reason", { quantity: 1, reason: " " }],
    ["nothing to change", { reason: "Count" }],
    ["two changes at once", { reason: "Count", quantity: 1, remove: [1] }],
    ["a blank serial", { reason: "Count", add: [{ serialNumber: " " }] }],
  ])("rejects %s", (_, body) => {
    expect(stockAdjustmentBody.safeParse(body).success).toBe(false)
  })
})
