import type { ApprovalDecision, Prisma } from "#generated/prisma/client.js"
import { db } from "#core/db.js"
import type { Actor } from "#security/auth.plugin.js"
import { APPROVAL_SCREEN_CODES, APPROVAL_SCREENS, type ApprovalScreen } from "./approvals.js"
import type { UpdateApprovalRuleBody } from "./approvals.schema.js"

// The rules (Admin → Approvals), and the decisions the screens in approvals.ts record. Who may approve or reject is
// only the screen's permission (<SCREEN>.APPROVE / .REJECT), so a user who has it can approve their own document.

const toRule = (screen: ApprovalScreen, isRequired: boolean | undefined) => ({
  screen,
  label: APPROVAL_SCREENS[screen],
  isRequired: isRequired ?? true,
})

/** Every screen in approvals.ts, saved or not. */
export async function listApprovalRules() {
  const rows = new Map((await db.approvalRule.findMany()).map((row) => [row.id, row.isRequired]))
  return APPROVAL_SCREEN_CODES.map((screen) => toRule(screen, rows.get(screen)))
}

export async function updateApprovalRule(screen: ApprovalScreen, { isRequired }: UpdateApprovalRuleBody, actor: Actor) {
  const row = await db.approvalRule.upsert({
    where: { id: screen },
    create: { id: screen, isRequired, createdBy: actor.id },
    update: { isRequired, modifiedBy: actor.id, modifiedAt: new Date() },
  })
  return toRule(screen, row.isRequired)
}

/** Whether the screen's documents need approval now. A rule nobody has saved yet means yes. */
export async function isApprovalRequired(screen: ApprovalScreen, tx?: Prisma.TransactionClient) {
  const args = { where: { id: screen }, select: { isRequired: true } } satisfies Prisma.ApprovalRuleFindUniqueArgs
  const row = tx ? await tx.approvalRule.findUnique(args) : await db.approvalRule.findUnique(args)
  return row?.isRequired ?? true
}

export interface ApprovalInput {
  screen: ApprovalScreen
  documentId: number
  decision: ApprovalDecision
  reason?: string // required when rejecting (the Approval_reason_check constraint)
  isAutomatic?: boolean // approved on save, because the screen didn't need approval
}

/**
 * Records a decision. Call it in the transaction that changes the document's status, after a state-guarded update
 * (e.g. updateMany where status = pending), so the two can't disagree and two approvers can't both decide.
 */
export function recordApproval(tx: Prisma.TransactionClient, input: ApprovalInput, actor: Actor) {
  return tx.approval.create({
    data: {
      screen: input.screen,
      documentId: input.documentId,
      decision: input.decision,
      reason: input.reason ?? null,
      isAutomatic: input.isAutomatic ?? false,
      createdBy: actor.id,
    },
  })
}

/** A document's decisions, oldest first, with who made them (the approvalList response schema). */
export function listApprovals(screen: ApprovalScreen, documentId: number) {
  return db.approval.findMany({
    where: { screen, documentId, isDeleted: false },
    select: {
      id: true,
      decision: true,
      isAutomatic: true,
      reason: true,
      createdAt: true,
      creator: { select: { id: true, name: true } },
    },
    orderBy: { id: "asc" },
  })
}
