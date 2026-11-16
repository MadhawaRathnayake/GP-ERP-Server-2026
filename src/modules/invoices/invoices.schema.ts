import { z } from "zod"
import { money } from "#http/fields.js"
import { pageQuery, pageResult } from "#http/pagination.js"
import {
  dateOnly,
  discountType,
  paymentTerms,
  quotationItemInput,
  quotationStatus,
  quotationType,
  referenceLink,
} from "#modules/quotations/quotations.schema.js"
import { fieldsNotAllowed } from "#modules/quotations/quotations.types.js"
import { deliveryNoteStatus } from "#modules/delivery-notes/delivery-notes.schema.js"
import { contentProblems, paymentProblems } from "./invoices.rules.js"

const customerId = z.string().regex(/^CUST\d{6,}$/, "Must be a customer id like CUST000001")
const userId = z.string().regex(/^USER\d{5,}$/, "Must be a user id like USER00001")
// Integer ids: anything above 2^31 − 1 can't exist (and would fail in Prisma, not 404).
const intId = z.coerce.number().int().positive().max(2147483647)

export const invoiceIdParams = z.object({ id: intId })

export const invoiceStatus = z
  .enum(["draft", "finalized", "cancelled", "cancelledAfterFinalized"])
  .describe("draft → finalized (numbered, stock moved). Cancelling a draft → cancelled, a finalized one → cancelledAfterFinalized")

export const paymentMethod = z.enum(["cash", "credit", "cheque", "bankTransfer"])

const party = z.object({ id: z.string(), name: z.string() })

export const invoiceItem = z.object({
  id: z.number().int(),
  lineNo: z.number().int(),
  productId: z.string(),
  product: z.object({
    sku: z.string(),
    title: z.string(),
    description: z.string().nullable(),
    imageUrl: z.string().nullable(),
    warrantyMonths: z.number().int(),
    trackingType: z.enum(["quantity", "serial"]),
  }),
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
  warrantyMonths: z.number().int().describe("The product's warranty when the line was saved"),
  warrantyEndsAt: dateOnly.nullable().describe("Set on finalize (warranty starts on the invoice); null before, or without warranty"),
})

// A unit scanned for a serial-tracked line: picked on the draft, sold once finalized.
export const invoiceSerialPick = z.object({
  productId: z.string(),
  serialItem: z.object({
    id: z.number().int(),
    serialNumber: z.string(),
    palletNumber: z.string().nullable(),
    accessories: z.array(z.object({ serialNumber: z.string(), accessory: z.object({ name: z.string() }) })),
  }),
})

// A list row: the invoice without its lines.
export const invoiceSummary = z.object({
  id: z.number().int(),
  draftNumber: z.string().describe("26NOV_GP01_3-draft, given on create"),
  invoiceNumber: z.string().nullable().describe("26NOV_GP01_14, given on finalize; show it, else draftNumber"),
  status: invoiceStatus,
  quotationId: z.number().int().nullable().describe("null for an invoice made without a quotation"),
  quotation: z.object({ id: z.number().int(), quotationNumber: z.string() }).nullable(),
  customerId: z.string(),
  customer: party.extend({ code: z.string() }),
  salesManagerId: z.string(),
  salesManager: party,
  type: quotationType,
  repairReceiveNoteId: z.string().nullable(),
  troubleshootId: z.string().nullable(),
  oldInvoiceId: z.number().int().nullable().describe("Service and warranty: the invoice the item was sold on"),
  oldInvoiceNumber: z.string().nullable().describe("Its number; old-system text without a link on imported quotations"),
  oldSerialItemId: z.number().int().nullable().describe("Service and warranty: the unit it is about"),
  oldSerialNumber: z.string().nullable().describe("Its serial; old-system text without a link on imported quotations"),
  productModel: z.string().nullable(),
  paymentTerms: paymentTerms.nullable(),
  deliveryLocation: z.string().nullable(),
  paymentMethod: paymentMethod.nullable(),
  paymentDetails: z.string().nullable(),
  dueDate: dateOnly,
  serviceCharge: money.nullable(),
  serviceTaxRate: money.nullable(),
  subtotal: money,
  discountTotal: money,
  taxTotal: money,
  grandTotal: money,
  notes: z.string().nullable(),
  finalizedBy: z.string().nullable(),
  finalizedAt: z.date().nullable(),
  cancelledBy: z.string().nullable(),
  cancelledAt: z.date().nullable(),
  isImported: z.boolean().describe("Imported from the old system: read only, can't be cancelled (409 INVOICE_IMPORTED)"),
  createdBy: z.string().nullable(),
  createdAt: z.date(),
  modifiedBy: z.string().nullable(),
  modifiedAt: z.date().nullable(),
  isDeleted: z.boolean(),
})

// What the printed invoice shows about the customer.
const documentCustomer = party.extend({
  code: z.string(),
  email: z.string().nullable(),
  phones: z.array(z.string()),
  houseNumber: z.string().nullable(),
  street: z.string().nullable(),
  city: z.string().nullable(),
  district: z.string().nullable(),
  country: z.string(),
  vatNumber: z.string().nullable(),
  tinNumber: z.string().nullable(),
})

// The quotation's own figures, to compare with the invoice's.
const quotationLine = z.object({
  productId: z.string(),
  quantity: z.number().int(),
  unitPrice: money,
  unitCost: money,
  discountAmount: money,
  lineTotal: money,
})

export const invoice = invoiceSummary.extend({
  customer: documentCustomer,
  items: z.array(invoiceItem),
  serialPicks: z.array(invoiceSerialPick).describe("Scanned units of the serial-tracked lines"),
  quotation: z
    .object({
      id: z.number().int(),
      quotationNumber: z.string(),
      status: quotationStatus,
      serviceCharge: money.nullable(),
      grandTotal: money,
      createdAt: z.date(),
      items: z.array(quotationLine),
    })
    .nullable(),
  deliveryNote: z
    .object({ id: z.number().int(), deliveryNoteNumber: z.string(), status: deliveryNoteStatus })
    .nullable()
    .describe("Made on finalize (not for service invoices)"),
  creator: party.nullable(),
  finalizer: party.nullable(),
  canceller: party.nullable(),
})

export const invoicePage = pageResult(invoiceSummary)

export const listInvoicesQuery = pageQuery.extend({
  status: invoiceStatus.optional(),
  type: quotationType.optional(),
  customerId: customerId.optional(),
  quotationId: intId.optional(),
})

export const invoiceIdsQuery = z.object({
  ids: z
    .string()
    .regex(/^[1-9]\d*(,[1-9]\d*)*$/, "Comma-separated invoice ids")
    .transform((text) => [...new Set(text.split(",").map(Number))])
    .pipe(z.array(z.number().int().max(2147483647)).max(100))
    .describe("Comma-separated invoice ids, at most 100"),
})

export const invoiceSummaryList = z.array(invoiceSummary)

const amount = money.refine((value) => value.gte(0), "Must be 0 or more")
const referenceId = (what: string) => z.string().trim().min(1).max(100).nullable().describe(`${what} (module not built yet: not checked)`)

// What can change on a draft: payment, notes and pricing. The header comes from the quotation.
const invoiceFields = z.object({
  paymentMethod: paymentMethod.nullable().describe("Required on sales and service invoices"),
  paymentDetails: z.string().trim().min(1).max(200).nullable().describe("Cheque number and bank, or the bank of a transfer"),
  dueDate: dateOnly,
  notes: z.string().trim().min(1).max(2000).nullable(),
  serviceCharge: amount.nullable().describe("Required on a service invoice, null on the others"),
  items: z
    .array(quotationItemInput)
    .max(200)
    .describe("In display order; at least one on sales and warranty, none on service. On update, replaces every line"),
})

const optionalFields = {
  paymentDetails: invoiceFields.shape.paymentDetails.default(null),
  notes: invoiceFields.shape.notes.default(null),
  serviceCharge: invoiceFields.shape.serviceCharge.default(null),
  items: invoiceFields.shape.items.default([]),
}

// The type, references, customer, sales manager, payment terms and delivery location are copied from the quotation,
// so the rules that depend on the type are checked in the service.
export const createInvoiceBody = invoiceFields.extend({
  quotationId: intId.describe("A payment- or credit-confirmed quotation without an invoice"),
  ...optionalFields,
})

// With INVOICES.CREATE_DIRECT: the header is sent instead of copied from a quotation.
export const createDirectInvoiceBody = invoiceFields
  .extend({
    ...optionalFields,
    customerId,
    salesManagerId: userId.describe("One of GET /invoices/sales-managers"),
    type: quotationType.default("sales"),
    repairReceiveNoteId: referenceId("Repair received note, service only").default(null),
    troubleshootId: referenceId("Troubleshoot, warranty only").default(null),
    oldInvoiceId: referenceLink("Id of the finalized invoice the item was sold on; service and warranty").default(null),
    oldSerialItemId: referenceLink("Id of the unit (GET /serial-items); service and warranty").default(null),
    productModel: z.string().trim().min(1).max(200).nullable().default(null).describe("Warranty only"),
    paymentTerms: paymentTerms.nullable().default(null),
    deliveryLocation: z.string().trim().min(1).max(500).nullable().default(null),
  })
  .superRefine((body, ctx) => {
    for (const field of fieldsNotAllowed(body.type, body)) {
      ctx.addIssue({ code: "custom", path: [field], message: `Must be null for a ${body.type} invoice` })
    }
    const problems = {
      ...contentProblems(body.type, { lineCount: body.items.length, hasServiceCharge: body.serviceCharge !== null }),
      ...paymentProblems(body.type, body.paymentMethod, body.paymentDetails),
    }
    for (const [field, message] of Object.entries(problems)) ctx.addIssue({ code: "custom", path: [field], message })
  })

// Drafts only. From the fields without defaults (see the pitfall in AGENTS.md).
export const updateInvoiceBody = invoiceFields.partial()

export const scanSerialBody = z.object({
  code: z.string().trim().min(1).max(100).describe("A unit's serial, one of its accessory serials, or a pallet number"),
})

export const scanSerialResult = z.object({
  added: z.array(z.object({ serialItemId: z.number().int(), serialNumber: z.string(), sku: z.string() })),
  skipped: z.number().int().describe("Units of a scanned pallet that couldn't be added (not on the invoice, line full, …)"),
})

export const invoiceSerialParams = z.object({ id: intId, serialItemId: intId })

export type ListInvoicesQuery = z.infer<typeof listInvoicesQuery>
export type CreateInvoiceBody = z.infer<typeof createInvoiceBody>
export type CreateDirectInvoiceBody = z.infer<typeof createDirectInvoiceBody>
export type UpdateInvoiceBody = z.infer<typeof updateInvoiceBody>
