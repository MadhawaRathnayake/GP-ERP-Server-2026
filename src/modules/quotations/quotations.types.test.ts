import { describe, expect, it } from "vitest"
import { createQuotationBody } from "./quotations.schema.js"
import { contentProblems, fieldsNotAllowed } from "./quotations.types.js"

describe("contentProblems", () => {
  const content = { lineCount: 1, hasServiceCharge: false, isPreOrdered: false }

  it("prices sales and warranty quotations by lines, without a service charge", () => {
    expect(contentProblems("sales", content)).toEqual({})
    expect(contentProblems("warranty", { ...content, lineCount: 0, hasServiceCharge: true })).toEqual({
      items: "Add at least one product",
      serviceCharge: "Only a service quotation has a service charge",
    })
  })

  it("prices a service quotation by its charge alone", () => {
    expect(contentProblems("service", { ...content, lineCount: 0, hasServiceCharge: true })).toEqual({})
    expect(contentProblems("service", content)).toEqual({
      items: "A service quotation has no product lines",
      serviceCharge: "A service quotation needs a service charge",
    })
  })

  it("lets only a sales quotation be a pre-order", () => {
    expect(contentProblems("sales", { ...content, isPreOrdered: true })).toEqual({})
    expect(contentProblems("warranty", { ...content, isPreOrdered: true })).toEqual({
      isPreOrdered: "Only a sales quotation can be a pre-order",
    })
  })
})

describe("fieldsNotAllowed", () => {
  it("allows no reference fields on a sales quotation", () => {
    expect(fieldsNotAllowed("sales", {})).toEqual([])
    expect(fieldsNotAllowed("sales", { oldInvoiceId: "INV1", productModel: null })).toEqual(["oldInvoiceId"])
  })

  it("allows a service quotation its repair note, old invoice and serial number", () => {
    expect(fieldsNotAllowed("service", { repairReceiveNoteId: "R1", oldInvoiceId: "INV1", oldSerialNumberId: "SN1" })).toEqual([])
    expect(fieldsNotAllowed("service", { troubleshootId: "T1", productModel: "X200" })).toEqual(["troubleshootId", "productModel"])
  })

  it("allows a warranty quotation its troubleshoot, old invoice, serial number and product model", () => {
    expect(
      fieldsNotAllowed("warranty", { troubleshootId: "T1", oldInvoiceId: "INV1", oldSerialNumberId: "SN1", productModel: "X200" }),
    ).toEqual([])
    expect(fieldsNotAllowed("warranty", { repairReceiveNoteId: "R1" })).toEqual(["repairReceiveNoteId"])
  })
})

describe("createQuotationBody", () => {
  const body = { customerId: "CUST000001", salesManagerId: "USER00001", items: [{ productId: "PROD000001", quantity: 1 }] }

  it("defaults to a sales quotation with no reference fields", () => {
    expect(createQuotationBody.parse(body)).toMatchObject({ type: "sales", repairReceiveNoteId: null, productModel: null })
  })

  it("rejects a reference field the type can't have", () => {
    const result = createQuotationBody.safeParse({ ...body, type: "service", productModel: "X200" })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(["productModel"])
  })
})
