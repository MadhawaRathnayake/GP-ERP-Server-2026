import { describe, expect, it } from "vitest"
import { approvalScreenParams, rejectBody, updateApprovalRuleBody } from "./approvals.schema.js"

describe("approvalScreenParams", () => {
  it("accepts only screens defined in approvals.ts", () => {
    expect(approvalScreenParams.safeParse({ screen: "INTERNAL_REQUISITIONS" }).success).toBe(true)
    expect(approvalScreenParams.safeParse({ screen: "INVOICES" }).success).toBe(false)
  })
})

describe("updateApprovalRuleBody", () => {
  it.each([[{}], [{ isRequired: "yes" }]])("rejects %j", (body) => {
    expect(updateApprovalRuleBody.safeParse(body).success).toBe(false)
  })
})

describe("rejectBody", () => {
  it("needs a reason, trimmed", () => {
    expect(rejectBody.parse({ reason: "  Wrong supplier " })).toEqual({ reason: "Wrong supplier" })
    expect(rejectBody.safeParse({ reason: "   " }).success).toBe(false)
    expect(rejectBody.safeParse({}).success).toBe(false)
  })
})
