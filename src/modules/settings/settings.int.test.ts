import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { App } from "#app.js"
import { db } from "#core/db.js"
import { cleanupTestUsers, signIn, startApp, waitForChange, type TestUser } from "#test/helpers.js"
import { getSettings, updateSettings, type Settings } from "./settings.service.js"

let app: App
let viewer: string
let admin: string
let adminUser: TestUser
let original: Settings

beforeAll(async () => {
  app = await startApp()
  viewer = (await signIn(app, [])).cookie
  adminUser = await signIn(app, ["ADMIN.EDIT_SETTINGS"])
  admin = adminUser.cookie
  original = await getSettings()
})

afterAll(async () => {
  const { currency, country, timezone } = original
  await updateSettings({ currency, country, timezone }, { id: adminUser.id, sessionId: "" })
  await cleanupTestUsers()
  await app.close()
})

describe("settings", () => {
  it("returns settings with the current server time to any signed-in user", async () => {
    const res = await app.inject({ url: "/api/v1/settings", headers: { cookie: viewer } })
    expect(res.statusCode).toBe(200)
    expect(Math.abs(Date.parse(res.json().serverTime) - Date.now())).toBeLessThan(5000)
  })

  it("requires ADMIN.EDIT_SETTINGS to update", async () => {
    const res = await app.inject({ method: "PATCH", url: "/api/v1/settings", headers: { cookie: viewer }, payload: { currency: "USD" } })
    expect(res.statusCode).toBe(403)
  })

  it("updates and serves the new value", async () => {
    const changed = waitForChange("Setting")
    const patch = await app.inject({ method: "PATCH", url: "/api/v1/settings", headers: { cookie: admin }, payload: { currency: "usd" } })
    expect(patch.json().currency).toBe("USD")
    await changed
    expect((await getSettings()).currency).toBe("USD")
  })

  it("picks up changes made outside the app", async () => {
    const changed = waitForChange("Setting")
    await db.$executeRaw`UPDATE "Setting" SET timezone = 'Europe/London' WHERE id = 1`
    await changed
    expect((await getSettings()).timezone).toBe("Europe/London")
  })

  it("rejects an invalid timezone", async () => {
    const res = await app.inject({ method: "PATCH", url: "/api/v1/settings", headers: { cookie: admin }, payload: { timezone: "Mars/Olympus" } })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("VALIDATION_ERROR")
  })
})
