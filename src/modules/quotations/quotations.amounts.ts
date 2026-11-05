import { Prisma, type DiscountType } from "#generated/prisma/client.js"

// Line and quotation amounts (the formulas are also in schema.prisma above QuotationItem). Plain functions with no
// database access, so quotations.amounts.test.ts can check them directly.

const ZERO = new Prisma.Decimal(0)

/** Rounds money half-up to 2 decimals, the precision of the Decimal(14, 2) columns. */
export const roundMoney = (value: Prisma.Decimal) => value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)

export interface LinePricing {
  quantity: number
  unitPrice: Prisma.Decimal
  discountType: DiscountType
  discountValue: Prisma.Decimal
  taxRate: Prisma.Decimal // percent
}

export interface LineAmounts {
  subtotal: Prisma.Decimal
  discountAmount: Prisma.Decimal
  taxAmount: Prisma.Decimal
  lineTotal: Prisma.Decimal
}

/** Discount is taken from the subtotal, then tax is charged on what's left. A fixed discount is for the whole line. */
export function lineAmounts({ quantity, unitPrice, discountType, discountValue, taxRate }: LinePricing): LineAmounts {
  const subtotal = roundMoney(unitPrice.mul(quantity))
  const discountAmount = roundMoney(
    discountType === "percentage" ? subtotal.mul(discountValue).div(100) : discountType === "fixed" ? discountValue : ZERO,
  )
  const taxAmount = roundMoney(subtotal.sub(discountAmount).mul(taxRate).div(100))
  return { subtotal, discountAmount, taxAmount, lineTotal: subtotal.sub(discountAmount).add(taxAmount) }
}

/** A service quotation's totals: it has no lines, only the service charge, with VAT on it. */
export function serviceTotals(serviceCharge: Prisma.Decimal, taxRate: Prisma.Decimal) {
  const taxTotal = roundMoney(serviceCharge.mul(taxRate).div(100))
  return { subtotal: serviceCharge, discountTotal: ZERO, taxTotal, grandTotal: serviceCharge.add(taxTotal) }
}

/** The quotation's totals: the sum of its lines' rounded amounts, so they always match the lines shown. */
export function quotationTotals(lines: LineAmounts[]) {
  const sum = (pick: (line: LineAmounts) => Prisma.Decimal) => lines.reduce((total, line) => total.add(pick(line)), ZERO)
  return {
    subtotal: sum((l) => l.subtotal),
    discountTotal: sum((l) => l.discountAmount),
    taxTotal: sum((l) => l.taxAmount),
    grandTotal: sum((l) => l.lineTotal),
  }
}
