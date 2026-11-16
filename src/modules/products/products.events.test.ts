import { describe, expect, it } from "vitest"
import { parseProductChange } from "./products.events.js"

// The trigger sends NEW."id" (migration 20261116120000_master_data_change_events).
describe("parseProductChange", () => {
  it("reads the trigger's payload", () => {
    expect(parseProductChange("PROD000001")).toBe("PROD000001")
  })

  it.each([
    ["empty", ""],
    ["another table's id", "CUST000001"],
    ["a number", "42"],
    ["JSON", JSON.stringify({ id: "PROD000001" })],
    ["extra text", "PROD000001 "],
  ])("rejects %s", (_, text) => {
    expect(parseProductChange(text)).toBeNull()
  })
})
