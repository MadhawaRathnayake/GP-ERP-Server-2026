import type { SalesDocumentType } from "#generated/prisma/client.js"

// A quotation is for a sale, a service (repair) or a warranty claim. Sales and warranty quotations are priced by product
// lines; a service quotation by its service charge alone (no lines). Only a sales quotation can be a pre-order.
// Service and warranty quotations carry references to what they're about; a type's fields are always null on the other
// types. The database enforces the same with the CHECK constraints "Quotation_type_fields_check",
// "Quotation_service_charge_check" and "Quotation_pre_order_check"; that a service quotation has a charge and no lines,
// and the others have lines, is checked only here (contentProblems).
//
// oldInvoiceId and oldSerialItemId are links to an invoice and a unit (quotations.references.ts copies their numbers).
// NOT BUILT YET: repairReceiveNoteId and troubleshootId are ids from modules that don't exist (repairs, troubleshoots).
// Until they do, they're optional free text that nothing checks. productModel is plain text the user types, by design.

export const TYPE_FIELDS = ["repairReceiveNoteId", "troubleshootId", "oldInvoiceId", "oldSerialItemId", "productModel"] as const

export type TypeField = (typeof TYPE_FIELDS)[number]

/** The reference fields each type may have. */
export const FIELDS_OF_TYPE: Record<SalesDocumentType, readonly TypeField[]> = {
  sales: [],
  service: ["repairReceiveNoteId", "oldInvoiceId", "oldSerialItemId"],
  warranty: ["troubleshootId", "oldInvoiceId", "oldSerialItemId", "productModel"],
}

/** The fields set (not null) that `type` can't have. Empty when the combination is valid. */
export function fieldsNotAllowed(type: SalesDocumentType, values: Partial<Record<TypeField, string | number | null>>): TypeField[] {
  return TYPE_FIELDS.filter((field) => values[field] != null && !FIELDS_OF_TYPE[type].includes(field))
}

/** What decides how a quotation is priced. */
export interface QuotationContent {
  lineCount: number
  hasServiceCharge: boolean
  isPreOrdered: boolean
}

/** Why the content doesn't fit the type, as { field: message }. Empty when it does. */
export function contentProblems(type: SalesDocumentType, { lineCount, hasServiceCharge, isPreOrdered }: QuotationContent) {
  const problems: Record<string, string> = {}
  if (type === "service") {
    if (lineCount > 0) problems.items = "A service quotation has no product lines"
    if (!hasServiceCharge) problems.serviceCharge = "A service quotation needs a service charge"
  } else {
    if (lineCount === 0) problems.items = "Add at least one product"
    if (hasServiceCharge) problems.serviceCharge = "Only a service quotation has a service charge"
  }
  if (isPreOrdered && type !== "sales") problems.isPreOrdered = "Only a sales quotation can be a pre-order"
  return problems
}
