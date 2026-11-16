import { describe, expect, it } from "vitest"
import { parseQuotationChange } from "./quotations.events.js"

// notify_quotation_change() sends NEW."id"::text (migration 20261116100000_quotation_change_events).
describe("parseQuotationChange", () => {
  it("reads the trigger's payload", () => {
    expect(parseQuotationChange("28041")).toBe(28041)
  })

  it.each([
    ["empty", ""],
    ["not a number", "GPQ-0000001"],
    ["zero", "0"],
    ["negative", "-3"],
    ["fractional", "1.5"],
    ["JSON", JSON.stringify({ id: 1 })],
    ["too large", "99999999999999999999"],
  ])("rejects %s", (_, text) => {
    expect(parseQuotationChange(text)).toBeNull()
  })
})
