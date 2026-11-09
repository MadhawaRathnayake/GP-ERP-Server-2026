import { AppError } from "#http/errors.js"

/** The verifier and the issuer can only be set on a draft note. */
export class DeliveryNoteNotDraftError extends AppError {
  constructor(id: number) {
    super(409, "DELIVERY_NOTE_NOT_DRAFT", `Delivery note ${id} isn't a draft, so its verifier and issuer can't change`)
  }
}

export class ItemVerifierRequiredError extends AppError {
  constructor(id: number) {
    super(409, "ITEM_VERIFIER_REQUIRED", `Delivery note ${id} needs an item verifier before the item issuer`)
  }
}

export class SameVerifierAndIssuerError extends AppError {
  constructor() {
    super(409, "SAME_VERIFIER_AND_ISSUER", "The item issuer can't be the same user as the item verifier")
  }
}
