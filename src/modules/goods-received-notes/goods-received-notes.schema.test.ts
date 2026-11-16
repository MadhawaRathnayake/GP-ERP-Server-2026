import { describe, expect, it } from "vitest"
import { addSerialsBody, createGoodsReceivedNoteBody, deliveryBody } from "./goods-received-notes.schema.js"

const base = { internalRequisitionId: 1 }
const line = (productId: string, quantity = 1, more: object = {}) => ({ productId, quantity, ...more })

describe("createGoodsReceivedNoteBody", () => {
  it("defaults to no supplier invoice, no remarks and no date (today)", () => {
    const body = createGoodsReceivedNoteBody.parse({ ...base, items: [line("PROD000001"), line("PROD000002", 0)] })
    expect(body).toMatchObject({ supplierInvoiceNumber: null, remarks: null, items: [{ remarks: null }, { remarks: null, quantity: 0 }] })
    expect(body.receivedDate).toBeUndefined()
  })

  it.each([
    ["no lines", { ...base, items: [] }],
    ["nothing received", { ...base, items: [line("PROD000001", 0), line("PROD000002", 0)] }],
    ["a product twice", { ...base, items: [line("PROD000001"), line("PROD000001")] }],
    ["a negative quantity", { ...base, items: [line("PROD000001", -1)] }],
    ["a part of a unit", { ...base, items: [line("PROD000001", 1.5)] }],
    ["no internal requisition", { items: [line("PROD000001")] }],
    ["a blank supplier invoice number", { ...base, supplierInvoiceNumber: " ", items: [line("PROD000001")] }],
  ])("rejects %s", (_, body) => {
    expect(createGoodsReceivedNoteBody.safeParse(body).success).toBe(false)
  })
})

describe("deliveryBody", () => {
  it("is the same delivery without the order", () => {
    expect(deliveryBody.parse({ receivedDate: "2026-12-01", items: [line("PROD000001")] })).toMatchObject({
      receivedDate: new Date("2026-12-01T00:00:00.000Z"),
    })
  })
})

describe("addSerialsBody", () => {
  it("takes units as scanned", () => {
    expect(addSerialsBody.parse({ productId: "PROD000001", units: [{ serialNumber: " SN-1 " }] })).toEqual({
      productId: "PROD000001",
      units: [{ serialNumber: "SN-1", palletNumber: null, accessories: [] }],
    })
  })

  it("needs at least one unit", () => {
    expect(addSerialsBody.safeParse({ productId: "PROD000001", units: [] }).success).toBe(false)
  })
})
