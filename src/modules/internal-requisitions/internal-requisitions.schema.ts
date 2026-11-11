import { z } from "zod"
import { pageQuery, pageResult } from "#http/pagination.js"
import { approvalList } from "#modules/approvals/approvals.schema.js"
import { purchaseOrderStatus } from "#modules/purchase-orders/purchase-orders.schema.js"
import { dateOnly } from "#modules/quotations/quotations.schema.js"

const supplierId = z.string().regex(/^SUP\d{5,}$/, "Must be a supplier id like SUP00001")
const productId = z.string().regex(/^PROD\d{6,}$/, "Must be a product id like PROD000001")
// Integer ids: anything above 2^31 − 1 can't exist (and would fail in Prisma, not 404).
const intId = z.coerce.number().int().positive().max(2147483647)

export const internalRequisitionIdParams = z.object({ id: intId })

export const internalRequisitionStatus = z
  .enum(["pending", "approved", "rejected", "cancelled", "cancelledAfterApproved"])
  .describe(
    "pending → approved | rejected (or approved on save when approval is off). Editing a rejected one → pending. " +
      "Cancelling an approved one → cancelledAfterApproved, any other → cancelled",
  )

const party = z.object({ id: z.string(), name: z.string() })

export const internalRequisitionItem = z.object({
  id: z.number().int(),
  lineNo: z.number().int(),
  productId: z.string(),
  product: z.object({ sku: z.string(), title: z.string(), imageUrl: z.string().nullable() }),
  quantity: z.number().int().describe("The order quantity"),
  stockInHand: z.number().int().describe("Product stock in hand when the line was saved (the old \"Available Qty\")"),
  minimumStock: z.number().int().describe("Product minimum stock when the line was saved (the old \"MOQ\")"),
})

// A list row: the IR without its lines.
export const internalRequisitionSummary = z.object({
  id: z.number().int(),
  internalRequisitionNumber: z.string().describe("GPIR-0001, GPIR-0002, …"),
  supplierId: z.string(),
  supplier: party.extend({ code: z.string() }),
  status: internalRequisitionStatus,
  isInternational: z.boolean().describe("No purchase order: the printed IR is the document, and the GRN is made from it"),
  eta: dateOnly.nullable().describe("Expected arrival"),
  cancelReason: z.string().nullable(),
  cancelledBy: z.string().nullable(),
  cancelledAt: z.date().nullable(),
  createdBy: z.string().nullable().describe("Prepared by"),
  creator: party.nullable(),
  createdAt: z.date().describe("The IR date"),
  modifiedBy: z.string().nullable(),
  modifiedAt: z.date().nullable(),
  isDeleted: z.boolean(),
})

export const internalRequisition = internalRequisitionSummary.extend({
  supplier: party.extend({
    code: z.string(),
    vatNumber: z.string().nullable(),
    email: z.string().nullable(),
    phones: z.array(z.string()),
    houseNumber: z.string().nullable(),
    street: z.string().nullable(),
    city: z.string().nullable(),
    district: z.string().nullable(),
    province: z.string().nullable(),
    country: z.string(),
  }),
  purchaseOrder: z
    .object({ id: z.number().int(), purchaseOrderNumber: z.string(), status: purchaseOrderStatus })
    .nullable()
    .describe("Local IRs: their purchase order, once made"),
  items: z.array(internalRequisitionItem),
  canceller: party.nullable(),
  approvals: approvalList,
})

export const internalRequisitionPage = pageResult(internalRequisitionSummary)

export const listInternalRequisitionsQuery = pageQuery.extend({
  q: z.string().trim().min(1).optional().describe("Case-insensitive partial match on the IR number or the supplier's code or name"),
  status: internalRequisitionStatus.optional(),
  supplierId: supplierId.optional(),
})

export const internalRequisitionItemInput = z.object({
  productId,
  quantity: z.number().int().min(1).max(1_000_000),
})

const internalRequisitionFields = z.object({
  supplierId,
  isInternational: z.boolean(),
  eta: dateOnly.nullable(),
  items: z
    .array(internalRequisitionItemInput)
    .min(1, "Add at least one product")
    .max(200)
    .refine((items) => new Set(items.map((item) => item.productId)).size === items.length, "Each product can be on one line only")
    .describe("In display order. On update, replaces every line"),
})

export const createInternalRequisitionBody = internalRequisitionFields.extend({
  isInternational: internalRequisitionFields.shape.isInternational.default(false),
  eta: internalRequisitionFields.shape.eta.default(null),
})

// Pending and rejected only. From the fields without defaults (see the pitfall in AGENTS.md).
export const updateInternalRequisitionBody = internalRequisitionFields.partial()

export const cancelInternalRequisitionBody = z.object({ reason: z.string().trim().min(1, "Give a reason").max(500) })

export type ListInternalRequisitionsQuery = z.infer<typeof listInternalRequisitionsQuery>
export type InternalRequisitionItemInput = z.infer<typeof internalRequisitionItemInput>
export type CreateInternalRequisitionBody = z.infer<typeof createInternalRequisitionBody>
export type UpdateInternalRequisitionBody = z.infer<typeof updateInternalRequisitionBody>
