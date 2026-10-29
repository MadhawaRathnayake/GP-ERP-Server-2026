import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { App } from "#app.js"
import { db } from "#core/db.js"
import { cleanupTestUsers, signIn, startApp, waitForChange, type TestUser } from "#test/helpers.js"

let app: App
let reader: TestUser
let noAccess: TestUser
const code = `TEST-${Date.now()}`

beforeAll(async () => {
  app = await startApp()
  reader = await signIn(app, ["CUSTOMERS.VIEW"])
  noAccess = await signIn(app, ["PRODUCTS.VIEW"])
  await db.customer.create({ data: { code, name: "Test Customer Ltd", email: "buyer@test.local", creditLimit: 50000 } })
})

afterAll(async () => {
  await db.customer.deleteMany({ where: { code: { startsWith: "TEST-" } } })
  await cleanupTestUsers()
  await app.close()
})

describe("customers", () => {
  it("requires CUSTOMERS.VIEW", async () => {
    expect((await app.inject({ url: "/api/v1/customers" })).statusCode).toBe(401)
    expect((await app.inject({ url: "/api/v1/customers", headers: { cookie: noAccess.cookie } })).statusCode).toBe(403)
  })

  it("lists and searches", async () => {
    const res = await app.inject({ url: `/api/v1/customers?q=${code}`, headers: { cookie: reader.cookie } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ total: 1, data: [{ code, name: "Test Customer Ltd", creditLimit: 50000 }] })
  })

  it("is cached until the Customer table changes", async () => {
    const url = `/api/v1/customers?q=${code}`
    expect((await app.inject({ url, headers: { cookie: reader.cookie } })).headers["x-cache"]).toBe("HIT")

    const changed = waitForChange("Customer")
    await db.customer.update({ where: { code }, data: { name: "Renamed Ltd" } })
    await changed

    const res = await app.inject({ url, headers: { cookie: reader.cookie } })
    expect(res.headers["x-cache"]).toBe("MISS")
    expect(res.json().data[0].name).toBe("Renamed Ltd")
  })

  it("gets one by id", async () => {
    const { id } = await db.customer.findUniqueOrThrow({ where: { code } })
    const res = await app.inject({ url: `/api/v1/customers/${id}`, headers: { cookie: reader.cookie } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ id, code })
  })
})
