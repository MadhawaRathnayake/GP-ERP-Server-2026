import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { App } from "#app.js"
import { db } from "#core/db.js"
import { cleanupTestUsers, signIn, startApp, waitForChange, type TestUser } from "#test/helpers.js"
import { isApprovalRequired, listApprovals, recordApproval } from "./approvals.service.js"

let app: App
let admin: TestUser // can view and edit the rules
let viewer: TestUser // can only view them
let saved: Awaited<ReturnType<typeof db.approvalRule.findUnique>>
const decisionIds: number[] = []

beforeAll(async () => {
  app = await startApp()
  admin = await signIn(app, ["APPROVALS.VIEW", "APPROVALS.EDIT"])
  viewer = await signIn(app, ["APPROVALS.VIEW"])
  // This file changes the real INTERNAL_REQUISITIONS rule; afterAll puts it back.
  saved = await db.approvalRule.findUnique({ where: { id: "INTERNAL_REQUISITIONS" } })
})

afterAll(async () => {
  if (saved) await db.approvalRule.update({ where: { id: saved.id }, data: saved })
  else await db.approvalRule.deleteMany({ where: { id: "INTERNAL_REQUISITIONS" } })
  await db.approval.deleteMany({ where: { id: { in: decisionIds } } })
  await cleanupTestUsers()
  await app.close()
})

const save = (who: TestUser, payload: object) =>
  app.inject({ method: "PATCH", url: "/api/v1/approvals/rules/INTERNAL_REQUISITIONS", headers: { cookie: who.cookie }, payload })

describe("approval rules", () => {
  it("lists every screen", async () => {
    const res = await app.inject({ url: "/api/v1/approvals/rules", headers: { cookie: viewer.cookie } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toContainEqual(expect.objectContaining({ screen: "INTERNAL_REQUISITIONS", label: "Internal requisitions" }))
  })

  it("requires APPROVALS.EDIT to change one", async () => {
    expect((await save(viewer, { isRequired: false })).statusCode).toBe(403)
  })

  it("turns approval off and on", async () => {
    const changed = waitForChange("ApprovalRule")
    const res = await save(admin, { isRequired: false })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ screen: "INTERNAL_REQUISITIONS", label: "Internal requisitions", isRequired: false })
    await changed
    expect(await isApprovalRequired("INTERNAL_REQUISITIONS")).toBe(false)
    await save(admin, { isRequired: true })
    expect(await isApprovalRequired("INTERNAL_REQUISITIONS")).toBe(true)
  })

  it("rejects unknown screens", async () => {
    const res = await app.inject({ method: "PATCH", url: "/api/v1/approvals/rules/NOPE", headers: { cookie: admin.cookie }, payload: { isRequired: false } })
    expect(res.statusCode).toBe(400)
  })
})

describe("decisions", () => {
  // A document id no internal requisition has, so the rows touch nothing real.
  const documentId = 2147483000

  it("keeps every decision, oldest first, with who made it", async () => {
    const actor = { id: admin.id, sessionId: "" }
    const rejected = await db.$transaction((tx) =>
      recordApproval(tx, { screen: "INTERNAL_REQUISITIONS", documentId, decision: "rejected", reason: "Wrong supplier" }, actor),
    )
    const approved = await db.$transaction((tx) =>
      recordApproval(tx, { screen: "INTERNAL_REQUISITIONS", documentId, decision: "approved" }, actor),
    )
    decisionIds.push(rejected.id, approved.id)
    expect(await listApprovals("INTERNAL_REQUISITIONS", documentId)).toMatchObject([
      { decision: "rejected", reason: "Wrong supplier", isAutomatic: false, creator: { id: admin.id } },
      { decision: "approved", reason: null, creator: { id: admin.id } },
    ])
  })

  it("refuses a rejection without a reason", async () => {
    await expect(
      db.$transaction((tx) => recordApproval(tx, { screen: "INTERNAL_REQUISITIONS", documentId, decision: "rejected" }, { id: admin.id, sessionId: "" })),
    ).rejects.toThrow()
  })
})
