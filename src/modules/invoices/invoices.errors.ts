import { AppError } from "#http/errors.js"

/** The quotation already has an invoice that isn't cancelled. */
export class InvoiceExistsError extends AppError {
  constructor(quotationId: number) {
    super(409, "INVOICE_EXISTS", `Quotation ${quotationId} already has an invoice`)
  }
}

/** Only a payment- or credit-confirmed quotation can be invoiced. */
export class QuotationNotConfirmedError extends AppError {
  constructor(quotationId: number) {
    super(409, "QUOTATION_NOT_CONFIRMED", `Quotation ${quotationId} isn't payment- or credit-confirmed, so it can't be invoiced`)
  }
}

/** Editing and finalizing are for drafts only. */
export class InvoiceNotDraftError extends AppError {
  constructor(id: number) {
    super(409, "INVOICE_NOT_DRAFT", `Invoice ${id} isn't a draft, so it can't be changed or finalized`)
  }
}

export class InvoiceCancelledError extends AppError {
  constructor(id: number) {
    super(409, "INVOICE_CANCELLED", `Invoice ${id} is already cancelled`)
  }
}

export interface StockShortage {
  productId: string
  sku: string
  needed: number
  inHand: number
}

/** An invoice can't be made for more than is in hand (pre-orders don't count here). */
export class InsufficientStockError extends AppError {
  constructor(shortages: StockShortage[]) {
    const list = shortages.map(({ sku, needed, inHand }) => `${sku} (needs ${needed}, ${inHand} in hand)`).join(", ")
    super(409, "INSUFFICIENT_STOCK", `Not enough stock: ${list}`, { shortages })
  }
}

/** Finalizing needs a serial for every unit of every serial-tracked line, scanned on the draft. */
export class SerialsMissingError extends AppError {
  constructor(lines: { sku: string; quantity: number; scanned: number }[]) {
    const list = lines.map(({ sku, quantity, scanned }) => `${sku} (${scanned} of ${quantity} scanned)`).join(", ")
    super(409, "SERIALS_MISSING", `Scan a serial number for every unit first: ${list}`, { lines })
  }
}

/** No unit, accessory or pallet has the scanned code. */
export class SerialNotFoundError extends AppError {
  constructor(code: string) {
    super(404, "SERIAL_NOT_FOUND", `No unit, accessory or pallet has the number ${code}`)
  }
}

/** The scanned unit can't go on this invoice: another product, already scanned, on another invoice, not in stock, … */
export class SerialNotAvailableError extends AppError {
  constructor(reason: string) {
    super(409, "SERIAL_NOT_AVAILABLE", reason)
  }
}

/** An invoice imported from the old system can't be cancelled here: its stock and units are as the old system left them. */
export class InvoiceImportedError extends AppError {
  constructor(id: number) {
    super(409, "INVOICE_IMPORTED", `Invoice ${id} was imported from the old system, so it can't be cancelled here`)
  }
}
