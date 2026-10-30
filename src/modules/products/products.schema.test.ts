import { describe, expect, it } from "vitest"
import { createProductBody, updateProductBody } from "./products.schema.js"

const required = { sku: "A", title: "A", categoryId: "CAT0001", warrantyMonths: 12, trackingType: "quantity" }

describe("product bodies", () => {
  it("fills defaults on create", () => {
    const body = createProductBody.parse(required)
    expect(body).toMatchObject({ description: "N/A", minimumStock: 0, stockInHand: 0, stockOnArrival: 0, additionalInfo: null })
    expect(body.price.toNumber()).toBe(0)
    expect(body.cost.toNumber()).toBe(0)
  })

  it("rejects negative price and stock", () => {
    expect(createProductBody.safeParse({ ...required, price: -1 }).success).toBe(false)
    expect(createProductBody.safeParse({ ...required, stockInHand: -1 }).success).toBe(false)
  })

  it("leaves fields that a PATCH doesn't send untouched", () => {
    expect(updateProductBody.parse({ title: "Renamed" })).toEqual({ title: "Renamed" })
  })
})
