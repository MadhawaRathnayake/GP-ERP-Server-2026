import { describe, expect, it } from "vitest"
import { createProductBody, updateProductBody } from "./products.schema.js"

const required = { sku: "A", title: "A", categoryId: "CAT0001", warrantyMonths: 12, trackingType: "quantity" }

describe("product bodies", () => {
  it("fills defaults on create", () => {
    expect(createProductBody.parse(required)).toMatchObject({ description: "N/A", minimumStock: 0, manufacturer: null, additionalInfo: null })
  })

  it("doesn't accept stock columns (they come from stock movements)", () => {
    expect(createProductBody.parse({ ...required, stockInHand: 5 })).not.toHaveProperty("stockInHand")
  })

  it("leaves fields that a PATCH doesn't send untouched", () => {
    expect(updateProductBody.parse({ title: "Renamed" })).toEqual({ title: "Renamed" })
  })
})
