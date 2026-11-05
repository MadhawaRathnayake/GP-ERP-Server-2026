import type { QuotationStatus } from "#generated/prisma/client.js"
import type { PermissionKey } from "#security/permissions.js"

// Each action on a quotation has its own permission, so an admin can decide per role which ones it may take, and so
// which ones are reversible for it (e.g. confirm without undo). PATCH /quotations/:id does all of them, so the service
// checks these, not the route.

/** What PATCH can change about a quotation's state. */
export interface QuotationState {
  status: QuotationStatus
  isDeleted: boolean
}

const CANCELLED: readonly QuotationStatus[] = ["cancelled", "cancelledAfterCredit", "cancelledAfterPayment"]
// Cancelling keeps the confirmation (cancelledAfter…), so reopening one of those undoes it.
const CONFIRMED: readonly QuotationStatus[] = ["paymentConfirmed", "creditConfirmed", "cancelledAfterPayment", "cancelledAfterCredit"]

/** The permissions a change from `from` to `to` needs. Nothing for a change that changes nothing. */
export function permissionsForChange(from: QuotationState, to: QuotationState, changesContent: boolean): PermissionKey[] {
  const keys: PermissionKey[] = []
  if (changesContent) keys.push("QUOTATIONS.EDIT")
  if (to.isDeleted !== from.isDeleted) keys.push(to.isDeleted ? "QUOTATIONS.DELETE" : "QUOTATIONS.RESTORE")
  if (to.status === from.status) return keys

  if (CANCELLED.includes(to.status)) return [...keys, "QUOTATIONS.CANCEL"]
  if (CANCELLED.includes(from.status)) keys.push("QUOTATIONS.REOPEN")
  if (CONFIRMED.includes(from.status)) keys.push("QUOTATIONS.UNDO_CONFIRMATION")
  if (to.status === "paymentConfirmed") keys.push("QUOTATIONS.CONFIRM_PAYMENT")
  if (to.status === "creditConfirmed") keys.push("QUOTATIONS.CONFIRM_CREDIT")
  return keys
}
