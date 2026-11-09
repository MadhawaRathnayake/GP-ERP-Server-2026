import type { InternalRequisitionStatus } from "#generated/prisma/client.js"
import { AppError } from "#http/errors.js"

/** Editing is for pending and rejected IRs only. */
export class InternalRequisitionNotEditableError extends AppError {
  constructor(id: number, status: InternalRequisitionStatus) {
    super(409, "INTERNAL_REQUISITION_NOT_EDITABLE", `Internal requisition ${id} is ${status}, so it can't be edited`)
  }
}

/** Approving and rejecting are for pending IRs only. */
export class InternalRequisitionNotPendingError extends AppError {
  constructor(id: number, status: InternalRequisitionStatus) {
    super(409, "INTERNAL_REQUISITION_NOT_PENDING", `Internal requisition ${id} is ${status}, not pending`)
  }
}

export class InternalRequisitionCancelledError extends AppError {
  constructor(id: number) {
    super(409, "INTERNAL_REQUISITION_CANCELLED", `Internal requisition ${id} is already cancelled`)
  }
}
