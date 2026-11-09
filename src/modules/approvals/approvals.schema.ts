import { z } from "zod"
import { APPROVAL_SCREEN_CODES } from "./approvals.js"

export const approvalScreen = z.enum(APPROVAL_SCREEN_CODES)

export const approvalScreenParams = z.object({ screen: approvalScreen })

export const approvalRule = z.object({
  screen: approvalScreen,
  label: z.string(),
  isRequired: z.boolean().describe("false = documents are approved on save"),
})

export const approvalRuleList = z.array(approvalRule)

export const updateApprovalRuleBody = z.object({ isRequired: z.boolean() })

export type UpdateApprovalRuleBody = z.infer<typeof updateApprovalRuleBody>

// For the screens that use approval: the body of their reject route, and the decisions in their detail response.
export const rejectBody = z.object({ reason: z.string().trim().min(1, "Give a reason").max(500) })

export type RejectBody = z.infer<typeof rejectBody>

export const approval = z.object({
  id: z.number().int(),
  decision: z.enum(["approved", "rejected"]),
  isAutomatic: z.boolean().describe("approved on save because the screen didn't need approval then"),
  reason: z.string().nullable(),
  createdAt: z.date(),
  creator: z.object({ id: z.string(), name: z.string() }).nullable().describe("who decided (who saved it, when automatic)"),
})

export const approvalList = z.array(approval).describe("approve and reject decisions, oldest first")
