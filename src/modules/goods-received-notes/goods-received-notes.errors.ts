import type { GoodsReceivedNoteStatus } from "#generated/prisma/client.js"
import { AppError } from "#http/errors.js"

/** Editing is for pending and rejected GRNs only. */
export class GoodsReceivedNoteNotEditableError extends AppError {
  constructor(id: number, status: GoodsReceivedNoteStatus) {
    super(409, "GOODS_RECEIVED_NOTE_NOT_EDITABLE", `GRN ${id} is ${status}, so it can't be edited`)
  }
}

/** Approving and rejecting are for pending GRNs only. */
export class GoodsReceivedNoteNotPendingError extends AppError {
  constructor(id: number, status: GoodsReceivedNoteStatus) {
    super(409, "GOODS_RECEIVED_NOTE_NOT_PENDING", `GRN ${id} is ${status}, not pending`)
  }
}

/** Cancelling is for pending and rejected GRNs only: an approved one has put its goods in stock. */
export class GoodsReceivedNoteNotCancellableError extends AppError {
  constructor(id: number, status: GoodsReceivedNoteStatus) {
    super(409, "GOODS_RECEIVED_NOTE_NOT_CANCELLABLE", `GRN ${id} is ${status}, so it can't be cancelled`)
  }
}

/**
 * A GRN is made from an approved purchase order (local IR) or an approved international IR, with something still
 * outstanding and no other open GRN.
 */
export class GoodsReceivedNoteSourceError extends AppError {
  constructor(message: string) {
    super(409, "GOODS_RECEIVED_NOTE_SOURCE", message)
  }
}

/** A line receives more than is still outstanding on the order. */
export class GoodsReceivedNoteQuantityError extends AppError {
  constructor(message: string) {
    super(409, "GOODS_RECEIVED_NOTE_QUANTITY", message)
  }
}

/** An order whose goods have been received (an approved GRN) can't be cancelled. */
export class GoodsAlreadyReceivedError extends AppError {
  constructor(requisitionNumber: string, grnNumber: string) {
    super(409, "GOODS_ALREADY_RECEIVED", `${requisitionNumber} has goods received on ${grnNumber}, so it can't be cancelled`)
  }
}
