import { AppError } from "#http/errors.js"

/** The adjustment doesn't fit the product's tracking: a number for a serial product, or units for a quantity one. */
export class TrackingMismatchError extends AppError {
  constructor(sku: string, trackingType: "quantity" | "serial") {
    super(
      409,
      "TRACKING_MISMATCH",
      trackingType === "serial"
        ? `${sku} is tracked by serial number: add, remove or register its units by serial`
        : `${sku} is counted by quantity: adjust it with a quantity`,
    )
  }
}

export class StockBelowZeroError extends AppError {
  constructor(sku: string, inHand: number, quantity: number) {
    super(409, "STOCK_BELOW_ZERO", `${sku} has ${inHand} in hand, so ${-quantity} can't be taken out`, { inHand })
  }
}

export class ProductDeletedError extends AppError {
  constructor(sku: string) {
    super(409, "PRODUCT_DELETED", `${sku} is deleted, so its stock can't be changed`)
  }
}

/** Registering serials for old stock: only as many as the stock that has none. */
export class NothingToRegisterError extends AppError {
  constructor(sku: string, withoutSerial: number) {
    super(409, "NOTHING_TO_REGISTER", `${sku} has ${Math.max(withoutSerial, 0)} in stock without a serial number`, {
      withoutSerial: Math.max(withoutSerial, 0),
    })
  }
}

/** A product whose stock has been counted (stock, units, GRN deliveries or invoice lines) keeps its tracking type. */
export class TrackingTypeLockedError extends AppError {
  constructor(sku: string) {
    super(409, "TRACKING_TYPE_LOCKED", `${sku} has stock, units, GRN deliveries or invoice lines, so its tracking type can't change`)
  }
}
