import type { QuotationType } from "#generated/prisma/client.js"

// A quotation is for a sale, a service (repair) or a warranty claim. Service and warranty quotations carry references
// to what they're about; a type's fields are always null on the other types. The database enforces the same with the
// CHECK constraint "Quotation_type_fields_check" (migration 20261105140000_quotation_types).
//
// NOT BUILT YET: repairReceiveNoteId, troubleshootId, oldInvoiceId and oldSerialNumberId are ids from modules that
// don't exist (repairs, troubleshoots, invoices, serial numbers). Until they do, they're optional free text that
// nothing checks. productModel is plain text the user types, by design.

export const TYPE_FIELDS = ["repairReceiveNoteId", "troubleshootId", "oldInvoiceId", "oldSerialNumberId", "productModel"] as const

export type TypeField = (typeof TYPE_FIELDS)[number]

/** The reference fields each type may have. */
export const FIELDS_OF_TYPE: Record<QuotationType, readonly TypeField[]> = {
  sales: [],
  service: ["repairReceiveNoteId", "oldInvoiceId", "oldSerialNumberId"],
  warranty: ["troubleshootId", "oldInvoiceId", "oldSerialNumberId", "productModel"],
}

/** The fields set (not null) that `type` can't have. Empty when the combination is valid. */
export function fieldsNotAllowed(type: QuotationType, values: Partial<Record<TypeField, string | null>>): TypeField[] {
  return TYPE_FIELDS.filter((field) => values[field] != null && !FIELDS_OF_TYPE[type].includes(field))
}
