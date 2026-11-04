import { AppError } from "#http/errors.js"

/** Someone tried to edit or delete a quotation that already has an invoice. */
export class QuotationInvoicedError extends AppError {
  constructor(id: number) {
    super(409, "QUOTATION_INVOICED", `Quotation ${id} has an invoice, so it can't be changed or deleted`)
  }
}

/** Someone tried to change the details or lines of, or delete, a quotation that isn't active. Its status can still change. */
export class QuotationNotActiveError extends AppError {
  constructor(id: number) {
    super(409, "QUOTATION_NOT_ACTIVE", `Quotation ${id} isn't active, so only its status can change`)
  }
}
