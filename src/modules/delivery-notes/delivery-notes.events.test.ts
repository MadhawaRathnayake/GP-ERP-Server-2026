import { describe, expect, it } from "vitest"
import { parseDeliveryNoteChange } from "./delivery-notes.events.js"

// notify_document_change() sends NEW."id"::text (migration 20261116110000_document_change_events).
describe("parseDeliveryNoteChange", () => {
  it("reads the trigger's payload", () => {
    expect(parseDeliveryNoteChange("28041")).toBe(28041)
  })

  it.each([
    ["empty", ""],
    ["not a number", "GPDN-0001"],
    ["zero", "0"],
    ["negative", "-3"],
    ["fractional", "1.5"],
    ["JSON", JSON.stringify({ id: 1 })],
    ["too large", "99999999999999999999"],
  ])("rejects %s", (_, text) => {
    expect(parseDeliveryNoteChange(text)).toBeNull()
  })
})
