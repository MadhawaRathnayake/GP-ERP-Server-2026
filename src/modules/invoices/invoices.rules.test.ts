import { describe, expect, it } from "vitest"
import { contentProblems, paymentProblems, quantitiesByProduct, stockShortages } from "./invoices.rules.js"

describe("contentProblems", () => {
  it("prices a service invoice by its charge alone", () => {
    expect(contentProblems("service", { lineCount: 0, hasServiceCharge: true })).toEqual({})
    expect(contentProblems("service", { lineCount: 1, hasServiceCharge: false })).toEqual({
      items: "A service invoice has no product lines",
      serviceCharge: "A service invoice needs a service charge",
    })
  })

  it.each(["sales", "warranty"] as const)("prices a %s invoice by its lines", (type) => {
    expect(contentProblems(type, { lineCount: 2, hasServiceCharge: false })).toEqual({})
    expect(contentProblems(type, { lineCount: 0, hasServiceCharge: true })).toEqual({
      items: "Add at least one product",
      serviceCharge: "Only a service invoice has a service charge",
    })
  })
})

describe("paymentProblems", () => {
  it.each(["sales", "service"] as const)("needs a payment method on a %s invoice", (type) => {
    expect(paymentProblems(type, null, null)).toEqual({ paymentMethod: "Choose the payment method" })
    expect(paymentProblems(type, "cash", null)).toEqual({})
  })

  it("lets a warranty invoice go without one", () => {
    expect(paymentProblems("warranty", null, null)).toEqual({})
  })

  it("takes payment details only with a cheque or a bank transfer", () => {
    expect(paymentProblems("sales", "cheque", "123456 - BOC")).toEqual({})
    expect(paymentProblems("sales", "bankTransfer", "HNB")).toEqual({})
    expect(paymentProblems("sales", "cash", "HNB")).toEqual({ paymentDetails: "Only for a cheque or a bank transfer" })
  })
})

describe("stock", () => {
  it("adds up each product's lines, in product id order", () => {
    expect(
      quantitiesByProduct([
        { productId: "PROD000002", quantity: 1 },
        { productId: "PROD000001", quantity: 2 },
        { productId: "PROD000002", quantity: 3 },
      ]),
    ).toEqual([
      { productId: "PROD000001", quantity: 2 },
      { productId: "PROD000002", quantity: 4 },
    ])
  })

  it("lists the products without enough in hand", () => {
    const levels = [
      { id: "PROD000001", sku: "A", stockInHand: 5 },
      { id: "PROD000002", sku: "B", stockInHand: 1 },
    ]
    const needs = [
      { productId: "PROD000001", quantity: 5 },
      { productId: "PROD000002", quantity: 2 },
      { productId: "PROD000003", quantity: 1 },
    ]
    expect(stockShortages(needs, levels)).toEqual([
      { productId: "PROD000002", sku: "B", needed: 2, inHand: 1 },
      { productId: "PROD000003", sku: "PROD000003", needed: 1, inHand: 0 },
    ])
  })
})
