import { describe, expect, it } from "vitest"
import { Prisma } from "#generated/prisma/client.js"
import { lineAmounts, quotationTotals, type LinePricing } from "./quotations.amounts.js"

const d = (n: number) => new Prisma.Decimal(n)
const asNumbers = (amounts: object) =>
  Object.fromEntries(Object.entries(amounts).map(([key, value]) => [key, value.toNumber()]))

const line = (overrides: Partial<LinePricing> = {}): LinePricing => ({
  quantity: 5,
  unitPrice: d(950),
  discountType: "none",
  discountValue: d(0),
  taxRate: d(0),
  ...overrides,
})

describe("lineAmounts", () => {
  it("applies a percentage discount to the line subtotal", () => {
    expect(asNumbers(lineAmounts(line({ discountType: "percentage", discountValue: d(10) })))).toEqual({
      subtotal: 4750,
      discountAmount: 475,
      taxAmount: 0,
      lineTotal: 4275,
    })
  })

  it("charges tax after the discount", () => {
    expect(asNumbers(lineAmounts(line({ discountType: "percentage", discountValue: d(10), taxRate: d(18) })))).toEqual({
      subtotal: 4750,
      discountAmount: 475,
      taxAmount: 769.5,
      lineTotal: 5044.5,
    })
  })

  it("takes a fixed discount off the whole line, not per unit", () => {
    expect(asNumbers(lineAmounts(line({ discountType: "fixed", discountValue: d(100) })))).toMatchObject({
      discountAmount: 100,
      lineTotal: 4650,
    })
  })

  it("ignores discountValue when there is no discount", () => {
    expect(lineAmounts(line({ discountType: "none", discountValue: d(50) })).discountAmount.toNumber()).toBe(0)
  })

  it("rounds each amount half-up to 2 decimals", () => {
    // 3 × 33.33 = 99.99; 12.5 % = 12.49875 → 12.50; tax 18 % of 87.49 = 15.7482 → 15.75
    expect(asNumbers(lineAmounts(line({ quantity: 3, unitPrice: d(33.33), discountType: "percentage", discountValue: d(12.5), taxRate: d(18) })))).toEqual({
      subtotal: 99.99,
      discountAmount: 12.5,
      taxAmount: 15.75,
      lineTotal: 103.24,
    })
  })
})

describe("quotationTotals", () => {
  it("adds up the lines", () => {
    const lines = [
      lineAmounts(line({ discountType: "percentage", discountValue: d(10), taxRate: d(18) })),
      lineAmounts(line({ quantity: 1, unitPrice: d(1000), discountType: "fixed", discountValue: d(100), taxRate: d(18) })),
    ]
    expect(asNumbers(quotationTotals(lines))).toEqual({ subtotal: 5750, discountTotal: 575, taxTotal: 931.5, grandTotal: 6106.5 })
  })

  it("is all zeros without lines", () => {
    expect(asNumbers(quotationTotals([]))).toEqual({ subtotal: 0, discountTotal: 0, taxTotal: 0, grandTotal: 0 })
  })
})
