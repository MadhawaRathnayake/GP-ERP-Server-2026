import { describe, expect, it } from "vitest"
import { parseGoodsReceivedNoteChange } from "./goods-received-notes.events.js"

// notify_document_change() sends NEW."id"::text (migration 20261116110000_document_change_events).
describe("parseGoodsReceivedNoteChange", () => {
  it("reads the trigger's payload", () => {
    expect(parseGoodsReceivedNoteChange("28041")).toBe(28041)
  })

  it.each([
    ["empty", ""],
    ["not a number", "GPGRN-0001"],
    ["zero", "0"],
    ["negative", "-3"],
    ["fractional", "1.5"],
    ["JSON", JSON.stringify({ id: 1 })],
    ["too large", "99999999999999999999"],
  ])("rejects %s", (_, text) => {
    expect(parseGoodsReceivedNoteChange(text)).toBeNull()
  })
})
