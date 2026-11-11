import { describe, expect, it } from "vitest"
import { createGoodsReceivedNoteBody, updateGoodsReceivedNoteBody } from "./goods-received-notes.schema.js"

const base = { internalRequisitionId: 1 }
const line = (productId: string, receivedQuantity = 1, more: object = {}) => ({ productId, receivedQuantity, ...more })

describe("createGoodsReceivedNoteBody", () => {
  it("defaults to no supplier invoice, no remarks and no date (today)", () => {
    const body = createGoodsReceivedNoteBody.parse({ ...base, items: [line("PROD000001"), line("PROD000002", 0)] })
    expect(body).toMatchObject({ supplierInvoiceNumber: null, items: [{ remarks: null }, { remarks: null, receivedQuantity: 0 }] })
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

describe("updateGoodsReceivedNoteBody", () => {
  it("keeps fields that aren't sent", () => {
    expect(updateGoodsReceivedNoteBody.parse({ receivedDate: "2026-12-01" })).toEqual({ receivedDate: new Date("2026-12-01T00:00:00.000Z") })
  })
})
