import type { PurchaseOrderStatus } from "#generated/prisma/client.js"
import { AppError } from "#http/errors.js"

/** Editing is for pending and rejected POs only. */
export class PurchaseOrderNotEditableError extends AppError {
  constructor(id: number, status: PurchaseOrderStatus) {
    super(409, "PURCHASE_ORDER_NOT_EDITABLE", `Purchase order ${id} is ${status}, so it can't be edited`)
  }
}

/** Approving and rejecting are for pending POs only. */
export class PurchaseOrderNotPendingError extends AppError {
  constructor(id: number, status: PurchaseOrderStatus) {
    super(409, "PURCHASE_ORDER_NOT_PENDING", `Purchase order ${id} is ${status}, not pending`)
  }
}

/** A completed or already cancelled PO can't be cancelled. */
export class PurchaseOrderNotCancellableError extends AppError {
  constructor(id: number, status: PurchaseOrderStatus) {
    super(409, "PURCHASE_ORDER_NOT_CANCELLABLE", `Purchase order ${id} is ${status}, so it can't be cancelled`)
  }
}

/** A PO is made only from a local IR that is pending or approved and has no PO yet. */
export class PurchaseOrderSourceError extends AppError {
  constructor(message: string) {
    super(409, "PURCHASE_ORDER_SOURCE", message)
  }
}
