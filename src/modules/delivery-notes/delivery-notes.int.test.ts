import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { App } from "#app.js"
import { db } from "#core/db.js"
import { cleanupTestUsers, keepUserDropdown, signIn, startApp, type TestUser } from "#test/helpers.js"

// Uses ERP-DB like every integration test, and uses up a delivery note number. The note is made here directly; that
// finalizing an invoice makes one is checked in invoices.int.test.ts.

let app: App
let user: TestUser // every delivery note permission; in both dropdowns
let other: TestUser // in both dropdowns
let viewer: TestUser
let customerId: string
let noteId: number
let restoreVerifiers: () => Promise<void>
let restoreIssuers: () => Promise<void>
const stamp = Date.now()

beforeAll(async () => {
  app = await startApp()
  user = await signIn(app, ["DELIVERY_NOTES.VIEW", "DELIVERY_NOTES.SET_VERIFIER", "DELIVERY_NOTES.SET_ISSUER"])
  other = await signIn(app, [])
  viewer = await signIn(app, ["DELIVERY_NOTES.VIEW"])
  // This file changes the real ITEM_VERIFIER and ITEM_ISSUER dropdowns; afterAll puts them back.
  restoreVerifiers = await keepUserDropdown("ITEM_VERIFIER")
  restoreIssuers = await keepUserDropdown("ITEM_ISSUER")
  for (const id of ["ITEM_VERIFIER", "ITEM_ISSUER"]) {
    const users = { source: "users" as const, userIds: [user.id, other.id] }
    await db.userDropdown.upsert({ where: { id }, create: { id, ...users }, update: users })
  }
  customerId = (await db.customer.create({ data: { code: `TEST-${stamp}`, type: "B2B", name: `Test Customer ${stamp}`, country: "Sri Lanka" } })).id
  const invoice = await db.invoice.create({
    data: {
      draftNumber: `TEST-${stamp}-draft`,
      invoiceNumber: `TEST-${stamp}`,
      status: "finalized",
      customerId,
      salesManagerId: user.id,
      dueDate: new Date(),
    },
  })
  noteId = (await db.deliveryNote.create({ data: { invoiceId: invoice.id } })).id
})

afterAll(async () => {
  await db.deliveryNote.deleteMany({ where: { invoice: { customerId } } })
  await db.invoice.deleteMany({ where: { customerId } })
  await db.customer.deleteMany({ where: { code: `TEST-${stamp}` } })
  await restoreVerifiers()
  await restoreIssuers()
  await cleanupTestUsers()
  await app.close()
})

const post = (who: TestUser, action: "verifier" | "issuer", userId: string) =>
  app.inject({ method: "POST", url: `/api/v1/delivery-notes/${noteId}/${action}`, headers: { cookie: who.cookie }, payload: { userId } })

describe("delivery notes", () => {
  it("shows the draft with its invoice and customer", async () => {
    const res = await app.inject({ url: `/api/v1/delivery-notes/${noteId}`, headers: { cookie: viewer.cookie } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ status: "draft", itemVerifier: null, invoice: { invoiceNumber: `TEST-${stamp}`, customer: { id: customerId } } })
    expect(res.json().deliveryNoteNumber).toMatch(/^GPDN-\d+$/)
  })

  it("needs DELIVERY_NOTES.SET_VERIFIER", async () => {
    expect((await post(viewer, "verifier", user.id)).statusCode).toBe(403)
  })

  it("needs a verifier before the issuer", async () => {
    expect((await post(user, "issuer", other.id)).json().error.code).toBe("ITEM_VERIFIER_REQUIRED")
  })

  it("only takes users from the dropdown", async () => {
    expect((await post(user, "verifier", viewer.id)).statusCode).toBe(400)
  })

  it("sets and changes the verifier while it's a draft", async () => {
    expect((await post(user, "verifier", other.id)).json().itemVerifierId).toBe(other.id)
    const res = await post(user, "verifier", user.id)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ status: "draft", itemVerifierId: user.id })
  })

  it("refuses the verifier as the issuer", async () => {
    expect((await post(user, "issuer", user.id)).json().error.code).toBe("SAME_VERIFIER_AND_ISSUER")
  })

  it("issues it with a different issuer, then locks it", async () => {
    const res = await post(user, "issuer", other.id)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ status: "issued", itemVerifierId: user.id, itemIssuerId: other.id })
    expect(res.json().issuedAt).not.toBeNull()
    expect((await post(user, "verifier", other.id)).json().error.code).toBe("DELIVERY_NOTE_NOT_DRAFT")
  })
})
