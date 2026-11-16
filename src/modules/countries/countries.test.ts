import { describe, expect, it } from "vitest"
import { COUNTRIES } from "./countries.js"
import { countryCode } from "./countries.schema.js"

describe("COUNTRIES", () => {
  it("has every ISO 3166-1 country once, each with an English name", () => {
    expect(COUNTRIES).toHaveLength(249)
    expect(new Set(COUNTRIES.map((country) => country.code)).size).toBe(249)
    for (const { code, name } of COUNTRIES) {
      expect(code).toMatch(/^[A-Z]{3}$/)
      expect(name).not.toMatch(/^[A-Z]{2}$/) // Intl knew its alpha-2 code
    }
    expect(COUNTRIES).toContainEqual({ code: "LKA", name: "Sri Lanka" })
  })
})

describe("countryCode", () => {
  it("takes an alpha-3 code in any case", () => {
    expect(countryCode.parse(" lka ")).toBe("LKA")
  })

  it.each(["LK", "XXX", "Sri Lanka", ""])("rejects %j", (value) => {
    expect(countryCode.safeParse(value).success).toBe(false)
  })
})
