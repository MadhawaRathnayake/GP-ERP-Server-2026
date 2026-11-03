import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { App } from "#app.js"
import { db } from "#core/db.js"
import { cleanupTestUsers, signIn, startApp, waitForChange, type TestUser } from "#test/helpers.js"

let app: App
let user: TestUser // can view, create, edit and delete customers
let viewer: TestUser // can only view them
let noAccess: TestUser // can't view them
const stamp = Date.now()
const code = `TEST-${stamp}` // test rows' codes start with TEST-, so afterAll can remove them
const name = `Test Customer ${stamp}`
const district = `TEST-District-${stamp}` // a district no real customer has, so the filters find only this test's
const body = { code, type: "B2B", name, city: "Colombo", district, province: "Western", country: "Sri Lanka" }

beforeAll(async () => {
  app = await startApp()
  user = await signIn(app, ["CUSTOMERS.VIEW", "CUSTOMERS.CREATE", "CUSTOMERS.EDIT", "CUSTOMERS.DELETE"])
  viewer = await signIn(app, ["CUSTOMERS.VIEW"])
  noAccess = await signIn(app, ["PRODUCTS.VIEW"])
})

afterAll(async () => {
  await db.customer.deleteMany({ where: { code: { startsWith: "TEST-" } } })
  await cleanupTestUsers()
  await app.close()
})

describe("customers", () => {
  let id: string

  it("requires a session and CUSTOMERS.VIEW", async () => {
    expect((await app.inject({ url: "/api/v1/customers" })).statusCode).toBe(401)
    expect((await app.inject({ url: "/api/v1/customers", headers: { cookie: noAccess.cookie } })).statusCode).toBe(403)
  })

  it("creates a customer with a CUST id and defaults", async () => {
    const payload = {
      ...body,
      phones: ["+94771234567"],
      vatNumber: "109860522-7000",
      contactPerson: "Nimal Perera",
      contactPhones: ["+94719876543"],
      notes: "Delivers on Mondays",
    }
    const res = await app.inject({ method: "POST", url: "/api/v1/customers", headers: { cookie: user.cookie }, payload })
    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({
      code,
      type: "B2B",
      phones: ["+94771234567"],
      title: null,
      contactPerson: "Nimal Perera",
      contactPhones: ["+94719876543"],
      notes: "Delivers on Mondays",
      isCommissioned: false,
      isActive: true,
      isDormant: false,
      lastInvoiceDate: null,
      totalInvoices: 0,
      createdBy: user.id,
      isDeleted: false,
    })
    expect(res.json().id).toMatch(/^CUST\d{6,}$/)
    id = res.json().id
  })

  it("ignores the system columns in a request", async () => {
    const system = { isActive: false, isDormant: true, lastInvoiceDate: "2020-01-01T00:00:00.000Z", totalInvoices: 99 }
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/customers",
      headers: { cookie: user.cookie },
      payload: { ...body, code: `${code}-SYS`, district: null, ...system }, // no district: the filter tests expect one match
    })
    expect(created.json()).toMatchObject({ isActive: true, isDormant: false, lastInvoiceDate: null, totalInvoices: 0 })
    const edited = await app.inject({ method: "PATCH", url: `/api/v1/customers/${created.json().id}`, headers: { cookie: user.cookie }, payload: system })
    expect(edited.json()).toMatchObject({ isActive: true, isDormant: false, lastInvoiceDate: null, totalInvoices: 0 })
  })

  it("creates a customer without an address", async () => {
    const payload = { code: `${code}-B2C`, type: "B2C", name: `${name} walk-in`, country: "Sri Lanka" }
    const res = await app.inject({ method: "POST", url: "/api/v1/customers", headers: { cookie: user.cookie }, payload })
    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ city: null, district: null, province: null })
  })

  it("needs CUSTOMERS.CREATE to create", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/customers", headers: { cookie: viewer.cookie }, payload: body })
    expect(res.statusCode).toBe(403)
  })

  it("rejects a badly formatted VAT number or an unknown type", async () => {
    const url = "/api/v1/customers"
    const badVat = await app.inject({ method: "POST", url, headers: { cookie: user.cookie }, payload: { ...body, vatNumber: "109860522" } })
    expect(badVat.statusCode).toBe(400)
    const badType = await app.inject({ method: "POST", url, headers: { cookie: user.cookie }, payload: { ...body, type: "B2X" } })
    expect(badType.statusCode).toBe(400)
  })

  it("filters by district and city", async () => {
    const res = await app.inject({ url: `/api/v1/customers?district=${district}&city=Colombo`, headers: { cookie: viewer.cookie } })
    expect(res.json()).toMatchObject({ total: 1, data: [{ id }] })
    const other = await app.inject({ url: `/api/v1/customers?district=${district}&city=Kandy`, headers: { cookie: viewer.cookie } })
    expect(other.json().total).toBe(0)
  })

  it("edits a customer; the cached list is cleared", async () => {
    const url = `/api/v1/customers?district=${district}`
    await app.inject({ url, headers: { cookie: viewer.cookie } })
    expect((await app.inject({ url, headers: { cookie: viewer.cookie } })).headers["x-cache"]).toBe("HIT")

    const changed = waitForChange("Customer")
    const payload = { name: `${name} Ltd` }
    const edit = await app.inject({ method: "PATCH", url: `/api/v1/customers/${id}`, headers: { cookie: user.cookie }, payload })
    // Only the name changes; a PATCH leaves the other fields alone.
    expect(edit.json()).toMatchObject({ name: `${name} Ltd`, phones: ["+94771234567"], vatNumber: "109860522-7000", modifiedBy: user.id })
    await changed

    const after = await app.inject({ url, headers: { cookie: viewer.cookie } })
    expect(after.headers["x-cache"]).toBe("MISS")
    expect(after.json().data[0].name).toBe(`${name} Ltd`)
  })

  it("searches by code, name or email", async () => {
    const res = await app.inject({ url: `/api/v1/customers?q=${code}`, headers: { cookie: viewer.cookie } })
    expect(res.json().data.map((c: { id: string }) => c.id)).toContain(id)
  })

  it("gets one by id", async () => {
    const res = await app.inject({ url: `/api/v1/customers/${id}`, headers: { cookie: viewer.cookie } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ id, code })
  })

  it("needs CUSTOMERS.EDIT to edit and CUSTOMERS.DELETE to delete", async () => {
    const url = `/api/v1/customers/${id}`
    expect((await app.inject({ method: "PATCH", url, headers: { cookie: viewer.cookie }, payload: { name: "X" } })).statusCode).toBe(403)
    expect((await app.inject({ method: "DELETE", url, headers: { cookie: viewer.cookie } })).statusCode).toBe(403)
  })

  it("deletes softly and restores", async () => {
    const changed = waitForChange("Customer")
    expect((await app.inject({ method: "DELETE", url: `/api/v1/customers/${id}`, headers: { cookie: user.cookie } })).statusCode).toBe(204)
    await changed

    const list = await app.inject({ url: `/api/v1/customers?district=${district}`, headers: { cookie: viewer.cookie } })
    expect(list.json().total).toBe(0)
    const all = await app.inject({ url: `/api/v1/customers?district=${district}&includeDeleted=true`, headers: { cookie: viewer.cookie } })
    expect(all.json().data).toContainEqual(expect.objectContaining({ id, isDeleted: true }))

    const payload = { isDeleted: false }
    const restore = await app.inject({ method: "PATCH", url: `/api/v1/customers/${id}`, headers: { cookie: user.cookie }, payload })
    expect(restore.json().isDeleted).toBe(false)
  })

  it("404s for an unknown id and 400s for a malformed one", async () => {
    expect((await app.inject({ url: "/api/v1/customers/CUST999999999", headers: { cookie: user.cookie } })).statusCode).toBe(404)
    expect((await app.inject({ url: "/api/v1/customers/123", headers: { cookie: user.cookie } })).statusCode).toBe(400)
  })
})
