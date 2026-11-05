import { describe, expect, it } from "vitest"
import { createQuotationBody } from "./quotations.schema.js"
import { fieldsNotAllowed } from "./quotations.types.js"

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
