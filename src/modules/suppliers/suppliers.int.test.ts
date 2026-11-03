import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { App } from "#app.js"
import { db } from "#core/db.js"
import { cleanupTestUsers, signIn, startApp, waitForChange, type TestUser } from "#test/helpers.js"

let app: App
let user: TestUser // can view, create, edit and delete suppliers
let viewer: TestUser // can only view them
const stamp = Date.now()
const code = `TEST-${stamp}` // test rows' codes start with TEST-, so afterAll can remove them
const name = `Test Supplier ${stamp}` // unique, so ?q= finds only this test's supplier
const body = { code, name, country: "Sri Lanka" }

beforeAll(async () => {
  app = await startApp()
  user = await signIn(app, ["SUPPLIERS.VIEW", "SUPPLIERS.CREATE", "SUPPLIERS.EDIT", "SUPPLIERS.DELETE"])
  viewer = await signIn(app, ["SUPPLIERS.VIEW"])
})

afterAll(async () => {
  await db.supplier.deleteMany({ where: { code: { startsWith: "TEST-" } } })
  await cleanupTestUsers()
  await app.close()
})

describe("suppliers", () => {
  let id: string

  it("creates a supplier with a SUP id and defaults", async () => {
    const payload = { ...body, phones: ["+94112345678"], vatNumber: "109860522-7000" }
    const res = await app.inject({ method: "POST", url: "/api/v1/suppliers", headers: { cookie: user.cookie }, payload })
    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ code, name, phones: ["+94112345678"], city: null, createdBy: user.id, isDeleted: false })
    expect(res.json().id).toMatch(/^SUP\d{5,}$/)
    id = res.json().id
  })

  it("needs SUPPLIERS.CREATE to create", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/suppliers", headers: { cookie: viewer.cookie }, payload: body })
    expect(res.statusCode).toBe(403)
  })

  it("rejects a badly formatted VAT number", async () => {
    const payload = { ...body, vatNumber: "109860522" }
    const res = await app.inject({ method: "POST", url: "/api/v1/suppliers", headers: { cookie: user.cookie }, payload })
    expect(res.statusCode).toBe(400)
  })

  it("lists and searches; the list is cached until the Supplier table changes", async () => {
    const url = `/api/v1/suppliers?q=${stamp}`
    const res = await app.inject({ url, headers: { cookie: viewer.cookie } })
    expect(res.json()).toMatchObject({ total: 1, data: [{ id }] })
    expect((await app.inject({ url, headers: { cookie: viewer.cookie } })).headers["x-cache"]).toBe("HIT")

    const changed = waitForChange("Supplier")
    const edit = await app.inject({ method: "PATCH", url: `/api/v1/suppliers/${id}`, headers: { cookie: user.cookie }, payload: { name: `${name} Ltd` } })
    // Only the name changes; a PATCH leaves the other fields alone.
    expect(edit.json()).toMatchObject({ name: `${name} Ltd`, phones: ["+94112345678"], vatNumber: "109860522-7000", modifiedBy: user.id })
    await changed

    const after = await app.inject({ url, headers: { cookie: viewer.cookie } })
    expect(after.headers["x-cache"]).toBe("MISS")
    expect(after.json().data[0].name).toBe(`${name} Ltd`)
  })

  it("deletes softly and restores", async () => {
    const changed = waitForChange("Supplier")
    expect((await app.inject({ method: "DELETE", url: `/api/v1/suppliers/${id}`, headers: { cookie: user.cookie } })).statusCode).toBe(204)
    await changed

    const list = await app.inject({ url: `/api/v1/suppliers?q=${stamp}`, headers: { cookie: viewer.cookie } })
    expect(list.json().total).toBe(0)
    const all = await app.inject({ url: `/api/v1/suppliers?q=${stamp}&includeDeleted=true`, headers: { cookie: viewer.cookie } })
    expect(all.json().data).toContainEqual(expect.objectContaining({ id, isDeleted: true }))

    const restore = await app.inject({ method: "PATCH", url: `/api/v1/suppliers/${id}`, headers: { cookie: user.cookie }, payload: { isDeleted: false } })
    expect(restore.json().isDeleted).toBe(false)
  })

  it("404s for an unknown id and 400s for a malformed one", async () => {
    expect((await app.inject({ url: "/api/v1/suppliers/SUP999999999", headers: { cookie: user.cookie } })).statusCode).toBe(404)
    expect((await app.inject({ url: "/api/v1/suppliers/123", headers: { cookie: user.cookie } })).statusCode).toBe(400)
  })
})
