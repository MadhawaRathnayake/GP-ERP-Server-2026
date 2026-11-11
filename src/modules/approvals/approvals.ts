// Every screen whose documents can need approval, with the label Admin → Approvals shows. The key is the screen's
// permission group. To give a screen approval:
//   1. add a line here (no migration: the rule row is written the first time an admin saves it; until then approval is
//      required);
//   2. give the screen's status enum pending, approved and rejected, and its permission group APPROVE and REJECT;
//   3. on save, start the document as pending, or as approved with recordApproval(…, isAutomatic) when
//      isApprovalRequired() says no; its approve and reject routes call recordApproval() in the transaction that changes
//      the status, and its detail response includes listApprovals().
export const APPROVAL_SCREENS = {
  INTERNAL_REQUISITIONS: "Internal requisitions",
  PURCHASE_ORDERS: "Purchase orders",
} as const satisfies Record<string, string>

export type ApprovalScreen = keyof typeof APPROVAL_SCREENS

export const APPROVAL_SCREEN_CODES = Object.keys(APPROVAL_SCREENS) as [ApprovalScreen, ...ApprovalScreen[]]
