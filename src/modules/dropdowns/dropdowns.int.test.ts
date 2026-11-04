import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { App } from "#app.js"
import { db } from "#core/db.js"
import { cleanupTestUsers, keepUserDropdown, signIn, startApp, waitForChange, type TestUser } from "#test/helpers.js"

let app: App
let admin: TestUser // can view and edit the dropdowns
let viewer: TestUser // can only view them
let member: TestUser // picked in the dropdown
let quoter: TestUser // reads the sales managers through the quotations API
let restoreSalesManagers: () => Promise<void>

beforeAll(async () => {
  app = await startApp()
  admin = await signIn(app, ["DROPDOWNS.VIEW", "DROPDOWNS.EDIT"])
  viewer = await signIn(app, ["DROPDOWNS.VIEW"])
  member = await signIn(app, [])
  quoter = await signIn(app, ["QUOTATIONS.VIEW"])
  // This file changes the real SALES_MANAGER dropdown; afterAll puts it back.
  restoreSalesManagers = await keepUserDropdown("SALES_MANAGER")
})

afterAll(async () => {
  await restoreSalesManagers()
  await cleanupTestUsers()
  await app.close()
})

const save = (who: TestUser, payload: object) =>
  app.inject({ method: "PATCH", url: "/api/v1/dropdowns/SALES_MANAGER", headers: { cookie: who.cookie }, payload })

async function salesManagerIds() {
  const res = await app.inject({ url: "/api/v1/quotations/sales-managers", headers: { cookie: quoter.cookie } })
  return res.json().map((user: { id: string }) => user.id) as string[]
}

describe("dropdowns", () => {
  it("lists every dropdown", async () => {
    const res = await app.inject({ url: "/api/v1/dropdowns", headers: { cookie: viewer.cookie } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toContainEqual(expect.objectContaining({ code: "SALES_MANAGER", label: "Sales manager on quotations" }))
  })

  it("requires DROPDOWNS.EDIT to change one", async () => {
    expect((await save(viewer, { source: "users" })).statusCode).toBe(403)
  })

  it("offers the users picked one by one", async () => {
    const changed = waitForChange("UserDropdown")
    const res = await save(admin, { source: "users", userIds: [member.id, member.id] })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ code: "SALES_MANAGER", source: "users", userIds: [member.id] })
    await changed
    expect(await salesManagerIds()).toEqual([member.id])
  })

  it("offers every user with a picked role, and keeps the user list", async () => {
    const changed = waitForChange("UserDropdown")
    const res = await save(admin, { source: "roles", roleIds: [quoter.roleId] })
    expect(res.json()).toMatchObject({ source: "roles", userIds: [member.id], roleIds: [quoter.roleId] })
    await changed
    expect(await salesManagerIds()).toEqual([quoter.id])
  })

  it("never offers a deactivated user", async () => {
    const changed = waitForChange("User")
    await db.user.update({ where: { id: quoter.id }, data: { isDeleted: true } })
    await changed
    // quoter is deactivated now, so read the list as another user.
    const reader = await signIn(app, ["QUOTATIONS.VIEW"])
    const res = await app.inject({ url: "/api/v1/quotations/sales-managers", headers: { cookie: reader.cookie } })
    expect(res.json()).toEqual([])
  })

  it("rejects unknown users and roles", async () => {
    expect((await save(admin, { userIds: ["USER99999999"] })).statusCode).toBe(400)
    expect((await save(admin, { roleIds: ["ROLE99999999"] })).statusCode).toBe(400)
    expect((await save(admin, {})).statusCode).toBe(400)
  })
})
