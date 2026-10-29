import { describe, expect, it } from "vitest"
import { hashPassword, verifyPassword } from "./password.js"

describe("password", () => {
  it("verifies the right password and rejects a wrong one", async () => {
    const hash = await hashPassword("correct horse")
    expect(hash.startsWith("scrypt$")).toBe(true)
    expect(await verifyPassword("correct horse", hash)).toBe(true)
    expect(await verifyPassword("wrong horse", hash)).toBe(false)
  })

  it("salts every hash", async () => {
    expect(await hashPassword("same")).not.toBe(await hashPassword("same"))
  })

  it("rejects malformed hashes", async () => {
    expect(await verifyPassword("x", "not-a-hash")).toBe(false)
  })
})
