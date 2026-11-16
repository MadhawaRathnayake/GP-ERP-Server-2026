import { describe, expect, it } from "vitest"
import { parseInternalRequisitionChange } from "./internal-requisitions.events.js"

// notify_document_change() sends NEW."id"::text (migration 20261116110000_document_change_events).
describe("parseInternalRequisitionChange", () => {
  it("reads the trigger's payload", () => {
    expect(parseInternalRequisitionChange("28041")).toBe(28041)
  })

  it.each([
    ["empty", ""],
    ["not a number", "GPIR-0001"],
    ["zero", "0"],
    ["negative", "-3"],
    ["fractional", "1.5"],
    ["JSON", JSON.stringify({ id: 1 })],
    ["too large", "99999999999999999999"],
  ])("rejects %s", (_, text) => {
    expect(parseInternalRequisitionChange(text)).toBeNull()
  })
})
