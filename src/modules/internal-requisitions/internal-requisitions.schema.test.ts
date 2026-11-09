import { describe, expect, it } from "vitest"
import { createInternalRequisitionBody, updateInternalRequisitionBody } from "./internal-requisitions.schema.js"

const supplierId = "SUP00001"
const line = (productId: string, quantity = 1) => ({ productId, quantity })

describe("createInternalRequisitionBody", () => {
  it("defaults to local with no ETA", () => {
    expect(createInternalRequisitionBody.parse({ supplierId, items: [line("PROD000001")] })).toMatchObject({ isInternational: false, eta: null })
  })

  it.each([
    ["no lines", { supplierId, items: [] }],
    ["a product twice", { supplierId, items: [line("PROD000001"), line("PROD000001", 2)] }],
    ["a quantity of 0", { supplierId, items: [line("PROD000001", 0)] }],
    ["a fractional quantity", { supplierId, items: [line("PROD000001", 1.5)] }],
  ])("rejects %s", (_, body) => {
    expect(createInternalRequisitionBody.safeParse(body).success).toBe(false)
  })
})

describe("updateInternalRequisitionBody", () => {
  it("keeps fields that aren't sent", () => {
    expect(updateInternalRequisitionBody.parse({ eta: "2026-12-01" })).toEqual({ eta: new Date("2026-12-01T00:00:00.000Z") })
  })
})
