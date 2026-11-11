import { z } from "zod"
import { money } from "#http/fields.js"
import { pageQuery, pageResult } from "#http/pagination.js"
import { approvalList } from "#modules/approvals/approvals.schema.js"
import { dateOnly, discountType } from "#modules/quotations/quotations.schema.js"

const supplierId = z.string().regex(/^SUP\d{5,}$/, "Must be a supplier id like SUP00001")
const productId = z.string().regex(/^PROD\d{6,}$/, "Must be a product id like PROD000001")
// Integer ids: anything above 2^31 − 1 can't exist (and would fail in Prisma, not 404).
const intId = z.coerce.number().int().positive().max(2147483647)

export const purchaseOrderIdParams = z.object({ id: intId })

export const purchaseOrderStatus = z
  .enum(["pending", "approved", "rejected", "completed", "cancelled", "cancelledAfterApproved"])
  .describe(
    "pending → approved | rejected (or approved on save when approval is off). Editing a rejected one → pending. " +
      "completed is set when its approved GRNs have received every line. Cancelling an approved one → cancelledAfterApproved, any other → cancelled",
  )

const party = z.object({ id: z.string(), name: z.string() })

export const purchaseOrderItem = z.object({
  id: z.number().int(),
  lineNo: z.number().int(),
  productId: z.string(),
  product: z.object({ sku: z.string(), title: z.string(), imageUrl: z.string().nullable() }),
  quantity: z.number().int(),
  unitPrice: money,
  discountType,
  discountValue: money,
  taxRate: money.describe("VAT percent from the settings when the line was saved"),
  subtotal: money,
  discountAmount: money,
  taxAmount: money,
  lineTotal: money,
})

// A list row: the PO without its lines.
export const purchaseOrderSummary = z.object({
  id: z.number().int(),
  purchaseOrderNumber: z.string().describe("GPPO-0001, GPPO-0002, …"),
  internalRequisitionId: z.number().int(),
  internalRequisition: z.object({ id: z.number().int(), internalRequisitionNumber: z.string() }),
  supplierId: z.string(),
  supplier: party.extend({ code: z.string() }),
  purchaseOrderDate: dateOnly.describe("The printed date"),
  status: purchaseOrderStatus,
  comments: z.string().nullable().describe("Printed: comments or special instructions"),
  remarks: z.string().nullable().describe("Internal, not printed"),
  subtotal: money,
  discountTotal: money,
  taxTotal: money,
  grandTotal: money,
  cancelReason: z.string().nullable(),
  cancelledBy: z.string().nullable(),
  cancelledAt: z.date().nullable(),
  createdBy: z.string().nullable(),
  creator: party.nullable(),
  createdAt: z.date(),
  modifiedBy: z.string().nullable(),
  modifiedAt: z.date().nullable(),
  isDeleted: z.boolean(),
})

// The detail also carries what the printed PO shows.
export const purchaseOrder = purchaseOrderSummary.extend({
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
  items: z.array(purchaseOrderItem),
  canceller: party.nullable(),
  approvals: approvalList,
})

export const purchaseOrderPage = pageResult(purchaseOrderSummary)

export const listPurchaseOrdersQuery = pageQuery.extend({
  q: z.string().trim().min(1).optional().describe("Case-insensitive partial match on the PO or IR number or the supplier's code or name"),
  status: purchaseOrderStatus.optional(),
  supplierId: supplierId.optional(),
})

const price = money.refine((value) => value.gt(0), "Must be more than 0")
const amount = money.refine((value) => value.gte(0), "Must be 0 or more")

// What a client sends for a line: one of the IR's products. taxRate and the amounts are always set by the server.
export const purchaseOrderItemInput = z
  .object({
    productId,
    quantity: z.number().int().min(1).max(1_000_000),
    unitPrice: price,
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

const purchaseOrderFields = z.object({
  supplierId,
  purchaseOrderDate: dateOnly,
  comments: z.string().trim().min(1).max(2000).nullable(),
  remarks: z.string().trim().min(1).max(2000).nullable(),
  items: z
    .array(purchaseOrderItemInput)
    .min(1, "Add at least one product")
    .max(200)
    .refine((items) => new Set(items.map((item) => item.productId)).size === items.length, "Each product can be on one line only")
    .describe("In display order, each one of the IR's products. On update, replaces every line"),
})

export const createPurchaseOrderBody = purchaseOrderFields.extend({
  internalRequisitionId: z.number().int().positive().max(2147483647).describe("A local IR, pending (approved by this save) or approved, with no PO"),
  purchaseOrderDate: purchaseOrderFields.shape.purchaseOrderDate.optional().describe("Defaults to today"),
  comments: purchaseOrderFields.shape.comments.default(null),
  remarks: purchaseOrderFields.shape.remarks.default(null),
})

// Pending and rejected only. From the fields without defaults (see the pitfall in AGENTS.md).
export const updatePurchaseOrderBody = purchaseOrderFields.partial()

export const cancelPurchaseOrderBody = z.object({ reason: z.string().trim().min(1, "Give a reason").max(500) })

export type ListPurchaseOrdersQuery = z.infer<typeof listPurchaseOrdersQuery>
export type PurchaseOrderItemInput = z.infer<typeof purchaseOrderItemInput>
export type CreatePurchaseOrderBody = z.infer<typeof createPurchaseOrderBody>
export type UpdatePurchaseOrderBody = z.infer<typeof updatePurchaseOrderBody>
