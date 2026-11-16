import { describe, expect, it } from "vitest"
import { parseCustomerChange } from "./customers.events.js"

// The trigger sends NEW."id" (migration 20261116120000_master_data_change_events).
describe("parseCustomerChange", () => {
  it("reads the trigger's payload", () => {
    expect(parseCustomerChange("CUST000001")).toBe("CUST000001")
  })

  it.each([
    ["empty", ""],
    ["another table's id", "SUP00001"],
    ["a number", "42"],
    ["JSON", JSON.stringify({ id: "CUST000001" })],
    ["extra text", "CUST000001 "],
  ])("rejects %s", (_, text) => {
    expect(parseCustomerChange(text)).toBeNull()
  })
})
