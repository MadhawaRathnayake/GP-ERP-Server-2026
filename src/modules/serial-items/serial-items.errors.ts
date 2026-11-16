import { AppError } from "#http/errors.js"

/** Serial numbers that are already a unit or an accessory, or repeated in the same list (ignoring case). */
export class SerialNumbersTakenError extends AppError {
  constructor(serialNumbers: string[]) {
    super(409, "SERIAL_NUMBERS_TAKEN", `Already used: ${serialNumbers.join(", ")}`, { serialNumbers })
  }
}

/** Units that aren't in stock, or aren't of the product they were picked for. */
export class SerialItemsNotAvailableError extends AppError {
  constructor(serialNumbers: string[]) {
    super(409, "SERIAL_ITEMS_NOT_AVAILABLE", `Not in stock for this product: ${serialNumbers.join(", ")}`, { serialNumbers })
  }
}
