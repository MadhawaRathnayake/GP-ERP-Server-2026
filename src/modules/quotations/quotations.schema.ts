import { z } from "zod"
import { money } from "#http/fields.js"
import { pageQuery, pageResult } from "#http/pagination.js"
import { fieldsNotAllowed, FIELDS_OF_TYPE } from "./quotations.types.js"

const customerId = z.string().regex(/^CUST\d{6,}$/, "Must be a customer id like CUST000001")
const productId = z.string().regex(/^PROD\d{6,}$/, "Must be a product id like PROD000001")
const userId = z.string().regex(/^USER\d{5,}$/, "Must be a user id like USER00001")

// The id column is a Postgres integer, so anything above 2^31 − 1 can't exist (and would fail in Prisma, not 404).
export const quotationIdParams = z.object({ id: z.coerce.number().int().positive().max(2147483647) })

/** A @db.Date column: "2026-11-04" in requests and responses, a Date at UTC midnight in code. */
const dateOnly = z
  .codec(z.iso.date(), z.date(), {
    decode: (day) => new Date(`${day}T00:00:00.000Z`),
    encode: (date) => date.toISOString().slice(0, 10),
  })
  .meta({ type: "string", format: "date", example: "2026-11-04" })

export const quotationStatus = z
  .enum([
    "draft",
    "pending",
    "approved",
    "rejected",
    "active",
    "accepted",
    "declined",
    "expired",
    "cancelled",
    "cancelledAfterCredit",
    "cancelledAfterPayment",
    "creditConfirmed",
    "paymentConfirmed",
    "invoiceCreated",
  ])
  .describe(
    "New quotations are active. Cancelling a credit- or payment-confirmed quotation stores cancelledAfterCredit or " +
      "cancelledAfterPayment. invoiceCreated is set by the invoice feature and locks the quotation",
  )

export const quotationType = z
  .enum(["sales", "service", "warranty"])
  .describe(
    `Which reference fields the quotation has: service → ${FIELDS_OF_TYPE.service.join(", ")}; warranty → ` +
      `${FIELDS_OF_TYPE.warranty.join(", ")}; sales → none. The others must be null`,
  )

export const paymentTerms = z.enum(["cashOnDelivery", "advancePayment"]).describe("How the customer pays; null = not set")

// The statuses a user may set. The rest are set by the system or reserved for later (see schema.prisma).
const settableStatus = z.enum(["active", "cancelled", "creditConfirmed", "paymentConfirmed"])

export const discountType = z
  .enum(["none", "percentage", "fixed"])
  .describe("percentage = discountValue % of the line subtotal; fixed = discountValue off the whole line, not per unit")

const party = z.object({ id: z.string(), name: z.string() })

export const quotationItem = z.object({
  id: z.number().int(),
  lineNo: z.number().int(),
  productId: z.string(),
  product: z.object({ sku: z.string(), description: z.string(), imageUrl: z.string().nullable() }),
  description: z.string(),
  quantity: z.number().int(),
  unitPrice: money,
  unitCost: money.describe("Product cost when the line was saved"),
  discountType,
  discountValue: money,
  taxRate: money.describe("VAT percent from the settings when the line was saved"),
  subtotal: money,
  discountAmount: money,
  taxAmount: money,
  lineTotal: money,
})

// A list row: the quotation without its lines.
export const quotationSummary = z.object({
  id: z.number().int(),
  customerId: z.string(),
  customer: party.extend({ code: z.string() }),
  salesManagerId: z.string(),
  salesManager: party,
  quotationDate: dateOnly,
  validUntil: dateOnly.nullable(),
  type: quotationType,
  repairReceiveNoteId: z.string().nullable(),
  troubleshootId: z.string().nullable(),
  oldInvoiceId: z.string().nullable(),
  oldSerialNumberId: z.string().nullable(),
  productModel: z.string().nullable(),
  paymentTerms: paymentTerms.nullable(),
  deliveryLocation: z.string().nullable(),
  status: quotationStatus,
  subtotal: money,
  discountTotal: money,
  taxTotal: money,
  grandTotal: money,
  notes: z.string().nullable(),
  terms: z.string().nullable(),
  createdBy: z.string().nullable(),
  createdAt: z.date(),
  modifiedBy: z.string().nullable(),
  modifiedAt: z.date().nullable(),
  isDeleted: z.boolean(),
})

// The detail's customer has what the printed quotation shows ("Bill To").
const documentCustomer = party.extend({
  code: z.string(),
  email: z.string().nullable(),
  phones: z.array(z.string()),
  houseNumber: z.string().nullable(),
  street: z.string().nullable(),
  city: z.string().nullable(),
  district: z.string().nullable(),
  country: z.string(),
  contactPerson: z.string().nullable(),
  contactPhones: z.array(z.string()),
  vatNumber: z.string().nullable(),
})

export const quotation = quotationSummary.extend({ customer: documentCustomer, items: z.array(quotationItem) })

export const quotationPage = pageResult(quotationSummary)

export const listQuotationsQuery = pageQuery.extend({
  customerId: customerId.optional(),
  salesManagerId: userId.optional(),
  status: quotationStatus.optional(),
  type: quotationType.optional(),
  from: dateOnly.optional().describe("Quotation date on or after this day"),
  to: dateOnly.optional().describe("Quotation date on or before this day"),
  includeDeleted: z.stringbool().default(false).describe("Include deleted quotations"),
})

const amount = money.refine((value) => value.gte(0), "Must be 0 or more")

// What a client sends for a line. unitCost, taxRate and the amounts are always set by the server.
const quotationItemInput = z
  .object({
    productId,
    description: z.string().trim().min(1).max(500).optional().describe("Defaults to the product title"),
    quantity: z.number().int().min(1),
    unitPrice: amount.optional().describe("Defaults to the product price"),
    discountType: discountType.default("none"),
    discountValue: amount.prefault(0),
  })
  .superRefine(({ discountType, discountValue }, ctx) => {
    if (discountType === "none" && !discountValue.isZero()) {
      ctx.addIssue({ code: "custom", path: ["discountValue"], message: "Must be 0 when discountType is none" })
    }
    if (discountType === "percentage" && discountValue.gt(100)) {
      ctx.addIssue({ code: "custom", path: ["discountValue"], message: "A percentage can't be more than 100" })
    }
  })

// Ids from modules that aren't built yet (see quotations.types.ts), so any text for now.
const referenceId = (what: string) => z.string().trim().min(1).max(100).nullable().describe(`${what} (module not built yet: not checked)`)

// Totals, status and the audit columns aren't here: zod drops them from a request.
const quotationFields = z.object({
  customerId,
  salesManagerId: userId.describe("One of GET /quotations/sales-managers"),
  quotationDate: dateOnly,
  validUntil: dateOnly.nullable(),
  notes: z.string().trim().min(1).max(2000).nullable(),
  terms: z.string().trim().min(1).max(5000).nullable(),
  type: quotationType,
  repairReceiveNoteId: referenceId("Repair received note, service only"),
  troubleshootId: referenceId("Troubleshoot, warranty only"),
  oldInvoiceId: referenceId("Earlier invoice, service and warranty"),
  oldSerialNumberId: referenceId("Serial number of the item, service and warranty"),
  productModel: z.string().trim().min(1).max(200).nullable().describe("Product model, typed by the user; warranty only"),
  paymentTerms: paymentTerms.nullable(),
  deliveryLocation: z.string().trim().min(1).max(500).nullable().describe("Where to deliver, typed by the user; any type"),
  items: z.array(quotationItemInput).min(1).max(200).describe("In display order. On update, replaces every line"),
})

export const createQuotationBody = quotationFields
  .extend({
    quotationDate: dateOnly.optional().describe("Defaults to today in the company timezone"),
    validUntil: quotationFields.shape.validUntil.default(null),
    notes: quotationFields.shape.notes.default(null),
    terms: quotationFields.shape.terms.default(null),
    type: quotationType.default("sales"),
    repairReceiveNoteId: quotationFields.shape.repairReceiveNoteId.default(null),
    troubleshootId: quotationFields.shape.troubleshootId.default(null),
    oldInvoiceId: quotationFields.shape.oldInvoiceId.default(null),
    oldSerialNumberId: quotationFields.shape.oldSerialNumberId.default(null),
    productModel: quotationFields.shape.productModel.default(null),
    paymentTerms: quotationFields.shape.paymentTerms.default(null),
    deliveryLocation: quotationFields.shape.deliveryLocation.default(null),
  })
  // An update is checked in the service, against the saved quotation.
  .superRefine((body, ctx) => {
    for (const field of fieldsNotAllowed(body.type, body)) {
      ctx.addIssue({ code: "custom", path: [field], message: `Must be null for a ${body.type} quotation` })
    }
  })

// From the fields without defaults (see the pitfall in AGENTS.md).
export const updateQuotationBody = quotationFields
  .extend({
    status: settableStatus.describe("active, cancelled, creditConfirmed or paymentConfirmed"),
    isDeleted: z.boolean().describe("true = deleted: hidden from lists by default"),
  })
  .partial()

export type ListQuotationsQuery = z.infer<typeof listQuotationsQuery>
export type CreateQuotationBody = z.infer<typeof createQuotationBody>
export type UpdateQuotationBody = z.infer<typeof updateQuotationBody>
export type QuotationItemInput = z.infer<typeof quotationItemInput>
