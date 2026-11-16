import { describe, expect, it } from "vitest"
import { parseInvoiceChange } from "./invoices.events.js"

// notify_invoice_change() sends NEW."id"::text (migration 20261116090000_invoice_change_events).
describe("parseInvoiceChange", () => {
  it("reads the trigger's payload", () => {
    expect(parseInvoiceChange("28041")).toBe(28041)
  })

  it.each([
    ["empty", ""],
    ["not a number", "INV-1"],
    ["zero", "0"],
    ["negative", "-3"],
    ["fractional", "1.5"],
    ["JSON", JSON.stringify({ id: 1 })],
    ["too large", "99999999999999999999"],
  ])("rejects %s", (_, text) => {
    expect(parseInvoiceChange(text)).toBeNull()
  })
})
