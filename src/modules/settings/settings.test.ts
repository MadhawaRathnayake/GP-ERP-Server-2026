import { describe, expect, it } from "vitest"
import { updateSettingsBody } from "./settings.schema.js"

describe("updateSettingsBody", () => {
  it("accepts valid codes and normalises case", () => {
    expect(updateSettingsBody.parse({ currency: "lkr", country: "lk", timezone: "Asia/Colombo" })).toEqual({
      currency: "LKR",
      country: "LK",
      timezone: "Asia/Colombo",
    })
  })

  it("accepts a partial update", () => {
    expect(updateSettingsBody.parse({ timezone: "UTC" })).toEqual({ timezone: "UTC" })
  })

  it.each([
    [{ currency: "XYZ1" }],
    [{ currency: "ABC" }],
    [{ country: "XX" }],
    [{ country: "LKA" }],
    [{ timezone: "Mars/Olympus" }],
    [{}],
  ])("rejects %j", (body) => {
    expect(updateSettingsBody.safeParse(body).success).toBe(false)
  })
})
