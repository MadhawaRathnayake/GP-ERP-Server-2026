import type { InvoicePaymentMethod, QuotationType } from "#generated/prisma/client.js"

// Plain rules with no database access, so invoices.rules.test.ts can check them directly. The type rules (which
// reference fields each type has) are the quotations' (quotations.types.ts); these are the ones that differ.

/** What decides how an invoice is priced: like a quotation, a service invoice by its charge, the others by lines. */
export interface InvoiceContent {
  lineCount: number
  hasServiceCharge: boolean
}

/** Why the content doesn't fit the type, as { field: message }. Empty when it does. */
export function contentProblems(type: QuotationType, { lineCount, hasServiceCharge }: InvoiceContent) {
  const problems: Record<string, string> = {}
  if (type === "service") {
    if (lineCount > 0) problems.items = "A service invoice has no product lines"
    if (!hasServiceCharge) problems.serviceCharge = "A service invoice needs a service charge"
  } else {
    if (lineCount === 0) problems.items = "Add at least one product"
    if (hasServiceCharge) problems.serviceCharge = "Only a service invoice has a service charge"
  }
  return problems
}

/** Why the payment fields don't fit, as { field: message }. A warranty invoice may have no payment method. */
export function paymentProblems(type: QuotationType, method: InvoicePaymentMethod | null, details: string | null) {
  const problems: Record<string, string> = {}
  if (!method && type !== "warranty") problems.paymentMethod = "Choose the payment method"
  if (details && method !== "cheque" && method !== "bankTransfer") {
    problems.paymentDetails = "Only for a cheque or a bank transfer"
  }
  return problems
}

export interface StockNeed {
  productId: string
  quantity: number
}

export interface StockLevel {
  id: string
  sku: string
  stockInHand: number
}

/**
 * The quantity of each product the lines need, added up (a product may be on more than one line), in product id
 * order, so stock rows are always locked in the same order.
 */
export function quantitiesByProduct(lines: readonly StockNeed[]): StockNeed[] {
  const totals = new Map<string, number>()
  for (const { productId, quantity } of lines) totals.set(productId, (totals.get(productId) ?? 0) + quantity)
  return [...totals].sort(([a], [b]) => a.localeCompare(b)).map(([productId, quantity]) => ({ productId, quantity }))
}

/** The products that don't have enough in hand. Empty when every line can be met. */
export function stockShortages(needs: readonly StockNeed[], levels: readonly StockLevel[]) {
  const byId = new Map(levels.map((level) => [level.id, level]))
  return needs.flatMap(({ productId, quantity }) => {
    const level = byId.get(productId)
    const inHand = level?.stockInHand ?? 0
    return quantity > inHand ? [{ productId, sku: level?.sku ?? productId, needed: quantity, inHand }] : []
  })
}
