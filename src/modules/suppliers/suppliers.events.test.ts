import { describe, expect, it } from "vitest"
import { parseSupplierChange } from "./suppliers.events.js"

// The trigger sends NEW."id" (migration 20261116120000_master_data_change_events).
describe("parseSupplierChange", () => {
  it("reads the trigger's payload", () => {
    expect(parseSupplierChange("SUP00001")).toBe("SUP00001")
  })

  it.each([
    ["empty", ""],
    ["another table's id", "CUST000001"],
    ["a number", "42"],
    ["JSON", JSON.stringify({ id: "SUP00001" })],
    ["extra text", "SUP00001 "],
  ])("rejects %s", (_, text) => {
    expect(parseSupplierChange(text)).toBeNull()
  })
})
