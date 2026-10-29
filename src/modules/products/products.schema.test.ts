import { describe, expect, it } from "vitest"
import { createProductBody, updateProductBody } from "./products.schema.js"

describe("product bodies", () => {
  it("fills defaults on create", () => {
    expect(createProductBody.parse({ sku: "A", name: "A", price: 1, cost: 1 })).toMatchObject({ status: "active", stock: 0 })
  })

  it("leaves fields that a PATCH doesn't send untouched", () => {
    expect(updateProductBody.parse({ name: "Renamed" })).toEqual({ name: "Renamed" })
  })
})
