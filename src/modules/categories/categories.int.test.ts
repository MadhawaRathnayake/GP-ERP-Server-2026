import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { App } from "#app.js"
import { db } from "#core/db.js"
import { cleanupTestUsers, signIn, startApp, waitForChange, type TestUser } from "#test/helpers.js"

let app: App
let user: TestUser // can view, create, edit and delete the catalogue
let viewer: TestUser // can only view it
const name = `TEST-CAT-${Date.now()}`

beforeAll(async () => {
  app = await startApp()
  user = await signIn(app, ["PRODUCTS.VIEW", "PRODUCTS.CREATE", "PRODUCTS.EDIT", "PRODUCTS.DELETE"])
  viewer = await signIn(app, ["PRODUCTS.VIEW"])
})

afterAll(async () => {
  await db.product.deleteMany({ where: { sku: { startsWith: "TEST-" } } })
  await db.category.deleteMany({ where: { name: { startsWith: "TEST-" } } })
  await cleanupTestUsers()
  await app.close()
})

describe("categories", () => {
  let id: string

  it("creates a category with a CAT id", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/categories", headers: { cookie: user.cookie }, payload: { name } })
    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ name, description: "", createdBy: user.id, isActive: true })
    expect(res.json().id).toMatch(/^CAT\d{4,}$/)
    id = res.json().id
  })

  it("needs PRODUCTS.CREATE to create", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/categories", headers: { cookie: viewer.cookie }, payload: { name: `${name}-2` } })
    expect(res.statusCode).toBe(403)
  })

  it("rejects a duplicate name with 409", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/categories", headers: { cookie: user.cookie }, payload: { name } })
    expect(res.statusCode).toBe(409)
  })

  it("edits a category", async () => {
    const res = await app.inject({ method: "PATCH", url: `/api/v1/categories/${id}`, headers: { cookie: user.cookie }, payload: { description: "Laptops" } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ name, description: "Laptops", modifiedBy: user.id })
  })

  it("won't delete a category that active products use", async () => {
    await db.product.create({ data: { sku: `TEST-${Date.now()}`, title: "In use", categoryId: id, warrantyMonths: 0, trackingType: "quantity" } })
    const res = await app.inject({ method: "DELETE", url: `/api/v1/categories/${id}`, headers: { cookie: user.cookie } })
    expect(res.statusCode).toBe(409)
    await db.product.updateMany({ where: { categoryId: id }, data: { isActive: false } })
  })

  it("deletes softly: deactivated and hidden from the list", async () => {
    const changed = waitForChange("Category")
    expect((await app.inject({ method: "DELETE", url: `/api/v1/categories/${id}`, headers: { cookie: user.cookie } })).statusCode).toBe(204)
    await changed
    const list = await app.inject({ url: "/api/v1/categories", headers: { cookie: viewer.cookie } })
    expect(list.json().map((c: { id: string }) => c.id)).not.toContain(id)
    const all = await app.inject({ url: "/api/v1/categories?includeInactive=true", headers: { cookie: viewer.cookie } })
    expect(all.json()).toContainEqual(expect.objectContaining({ id, isActive: false }))
  })

  it("404s for an unknown id", async () => {
    expect((await app.inject({ url: "/api/v1/categories/CAT9999999", headers: { cookie: user.cookie } })).statusCode).toBe(404)
  })
})
