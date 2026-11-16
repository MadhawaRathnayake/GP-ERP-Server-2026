import type { Prisma } from "#generated/prisma/client.js"
import { db } from "#core/db.js"
import { BadRequestError } from "#http/errors.js"

// Service and warranty quotations (and their invoices) are about an item sold before: the invoice it was sold on and
// the unit itself. Both are links (oldInvoiceId, oldSerialItemId) with the number copied next to them
// (oldInvoiceNumber, oldSerialNumber), so a document still reads right on its own. Imported old-system quotations have
// the numbers as text and no link, until the old data is imported.

export interface ReferenceIds {
  oldInvoiceId?: number | null
  oldSerialItemId?: number | null
}

/**
 * The numbers for the links that are sent: null for null, the invoice's number (a finalized one) and the unit's serial
 * otherwise (400 when they don't exist). A link that isn't sent (undefined) gives nothing, so its number stays.
 */
export async function referenceNumbers(
  { oldInvoiceId, oldSerialItemId }: ReferenceIds,
  reader: Prisma.TransactionClient | typeof db = db,
): Promise<{ oldInvoiceNumber?: string | null; oldSerialNumber?: string | null }> {
  const numbers: { oldInvoiceNumber?: string | null; oldSerialNumber?: string | null } = {}
  if (oldInvoiceId !== undefined) {
    if (oldInvoiceId === null) numbers.oldInvoiceNumber = null
    else {
      const invoice = await reader.invoice.findUnique({ where: { id: oldInvoiceId }, select: { invoiceNumber: true, isDeleted: true } })
      if (!invoice || invoice.isDeleted || !invoice.invoiceNumber) {
        throw new BadRequestError(`Invoice ${oldInvoiceId} doesn't exist or isn't finalized`)
      }
      numbers.oldInvoiceNumber = invoice.invoiceNumber
    }
  }
  if (oldSerialItemId !== undefined) {
    if (oldSerialItemId === null) numbers.oldSerialNumber = null
    else {
      const unit = await reader.serialItem.findUnique({ where: { id: oldSerialItemId }, select: { serialNumber: true, isDeleted: true } })
      if (!unit || unit.isDeleted) throw new BadRequestError(`Serial item ${oldSerialItemId} doesn't exist`)
      numbers.oldSerialNumber = unit.serialNumber
    }
  }
  return numbers
}
