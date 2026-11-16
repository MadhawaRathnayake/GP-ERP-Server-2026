import { describe, expect, it } from "vitest"
import { customerIdsQuery } from "#modules/customers/customers.schema.js"
import { deliveryNoteIdsQuery } from "#modules/delivery-notes/delivery-notes.schema.js"
import { goodsReceivedNoteIdsQuery } from "#modules/goods-received-notes/goods-received-notes.schema.js"
import { internalRequisitionIdsQuery } from "#modules/internal-requisitions/internal-requisitions.schema.js"
import { invoiceIdsQuery } from "#modules/invoices/invoices.schema.js"
import { productIdsQuery } from "#modules/products/products.schema.js"
import { purchaseOrderIdsQuery } from "#modules/purchase-orders/purchase-orders.schema.js"
import { quotationIdsQuery } from "#modules/quotations/quotations.schema.js"
import { supplierIdsQuery } from "#modules/suppliers/suppliers.schema.js"

// The `ids` of every GET /<screen>/by-ids, which clients call after each live event (modules/events).
const numberIds = [
  ["delivery notes", deliveryNoteIdsQuery],
  ["GRNs", goodsReceivedNoteIdsQuery],
  ["internal requisitions", internalRequisitionIdsQuery],
  ["invoices", invoiceIdsQuery],
  ["purchase orders", purchaseOrderIdsQuery],
  ["quotations", quotationIdsQuery],
] as const

const textIds = [
  ["customers", customerIdsQuery, "CUST000001,CUST001234"],
  ["products", productIdsQuery, "PROD000001,PROD001234"],
  ["suppliers", supplierIdsQuery, "SUP00001,SUP01234"],
] as const

describe("by-ids query", () => {
  it.each(numberIds)("%s: reads multi-digit ids and drops repeats", (_, query) => {
    expect(query.parse({ ids: "9807,12,9807" }).ids).toEqual([9807, 12])
  })

  it.each(numberIds)("%s: rejects what isn't a list of ids", (_, query) => {
    for (const ids of ["", "0", "1d", "1,,2", "-3", "abc"]) expect(query.safeParse({ ids }).success).toBe(false)
  })

  it.each(textIds)("%s: reads its own ids", (_, query, ids) => {
    expect(query.parse({ ids }).ids).toEqual(ids.split(","))
  })

  it.each(textIds)("%s: rejects other ids", (_, query) => {
    for (const ids of ["", "42", "X000001", "CUST000001,"]) expect(query.safeParse({ ids }).success).toBe(false)
  })

  it("takes at most 100", () => {
    const ids = Array.from({ length: 101 }, (_, n) => n + 1).join(",")
    expect(invoiceIdsQuery.safeParse({ ids }).success).toBe(false)
  })
})
