import { AppError } from "#http/errors.js"

/**
 * A GRN is made from an approved purchase order (local IR) or an approved international IR that has no GRN yet, and a
 * delivery needs something still outstanding.
 */
export class GoodsReceivedNoteSourceError extends AppError {
  constructor(message: string) {
    super(409, "GOODS_RECEIVED_NOTE_SOURCE", message)
  }
}

/** A delivery line brings more than is still outstanding on the order. */
export class GoodsReceivedNoteQuantityError extends AppError {
  constructor(message: string) {
    super(409, "GOODS_RECEIVED_NOTE_QUANTITY", message)
  }
}

/** Serials for a line that isn't serial-tracked, or more than the line still misses. */
export class GoodsReceivedNoteSerialsError extends AppError {
  constructor(message: string) {
    super(409, "GOODS_RECEIVED_NOTE_SERIALS", message)
  }
}

/** An order whose goods have started to arrive (it has a GRN) can't be cancelled. */
export class GoodsAlreadyReceivedError extends AppError {
  constructor(requisitionNumber: string, grnNumber: string) {
    super(409, "GOODS_ALREADY_RECEIVED", `${requisitionNumber} has goods received on ${grnNumber}, so it can't be cancelled`)
  }
}
