import { z } from "zod"
import { pageQuery, pageResult } from "#http/pagination.js"
import { approvalList } from "#modules/approvals/approvals.schema.js"
import { purchaseOrderStatus } from "#modules/purchase-orders/purchase-orders.schema.js"
import { dateOnly } from "#modules/quotations/quotations.schema.js"

const supplierId = z.string().regex(/^SUP\d{5,}$/, "Must be a supplier id like SUP00001")
const productId = z.string().regex(/^PROD\d{6,}$/, "Must be a product id like PROD000001")
// Integer ids: anything above 2^31 − 1 can't exist (and would fail in Prisma, not 404).
const intId = z.coerce.number().int().positive().max(2147483647)

export const goodsReceivedNoteIdParams = z.object({ id: intId })

export const orderParams = z.object({ internalRequisitionId: intId })

export const goodsReceivedNoteStatus = z
  .enum(["pending", "approved", "rejected", "cancelled"])
  .describe(
    "pending → approved (adds the goods to stock) | rejected (or approved on save when approval is off). Editing a " +
      "rejected one → pending. A pending or rejected one can be cancelled",
  )

const party = z.object({ id: z.string(), name: z.string() })
const product = z.object({ sku: z.string(), title: z.string(), imageUrl: z.string().nullable() })

export const goodsReceivedNoteItem = z.object({
  id: z.number().int(),
  lineNo: z.number().int(),
  productId: z.string(),
  product,
  orderedQuantity: z.number().int().describe("The order line's quantity (the PO's, or the international IR's)"),
  receivedQuantity: z.number().int().describe("Received in this delivery"),
  remarks: z.string().nullable(),
})

// The IR a GRN receives against, with its PO when it's local.
const requisitionRef = z.object({
  id: z.number().int(),
  internalRequisitionNumber: z.string(),
  isInternational: z.boolean(),
  purchaseOrder: z.object({ id: z.number().int(), purchaseOrderNumber: z.string() }).nullable(),
})

// A list row: the GRN without its lines.
export const goodsReceivedNoteSummary = z.object({
  id: z.number().int(),
  grnNumber: z.string().describe("GPGRN-0001, GPGRN-0002, …"),
  internalRequisitionId: z.number().int(),
  internalRequisition: requisitionRef,
  supplierId: z.string(),
  supplier: party.extend({ code: z.string() }),
  receivedDate: dateOnly.describe("The printed date"),
  supplierInvoiceNumber: z.string().nullable(),
  status: goodsReceivedNoteStatus,
  cancelReason: z.string().nullable(),
  cancelledBy: z.string().nullable(),
  cancelledAt: z.date().nullable(),
  createdBy: z.string().nullable().describe("Prepared by"),
  creator: party.nullable(),
  createdAt: z.date(),
  modifiedBy: z.string().nullable(),
  modifiedAt: z.date().nullable(),
  isDeleted: z.boolean(),
})

// The detail also carries what the printed GRN shows.
export const goodsReceivedNote = goodsReceivedNoteSummary.extend({
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
  items: z.array(goodsReceivedNoteItem),
  canceller: party.nullable(),
  approvals: approvalList,
})

export const goodsReceivedNotePage = pageResult(goodsReceivedNoteSummary)

// What an order (an IR, with its PO when local) has received so far, for the GRN form and the IR and PO pages.
export const orderReceipt = z.object({
  internalRequisitionId: z.number().int(),
  internalRequisitionNumber: z.string(),
  isInternational: z.boolean(),
  purchaseOrder: z.object({ id: z.number().int(), purchaseOrderNumber: z.string(), status: purchaseOrderStatus }).nullable(),
  supplier: party.extend({ code: z.string() }),
  lines: z
    .array(
      z.object({
        productId: z.string(),
        product,
        orderedQuantity: z.number().int(),
        receivedQuantity: z.number().int().describe("Σ received on the order's approved GRNs"),
        outstandingQuantity: z.number().int().describe("orderedQuantity − receivedQuantity, never below 0"),
      }),
    )
    .describe("The PO's lines (local IR; none until it has one) or the IR's (international), in order"),
  goodsReceivedNotes: z
    .array(z.object({ id: z.number().int(), grnNumber: z.string(), status: goodsReceivedNoteStatus, receivedDate: dateOnly }))
    .describe("Every GRN of the order, newest first"),
  blockedReason: z.string().nullable().describe("Why a GRN can't be made for the order now; null when it can"),
})

export const listGoodsReceivedNotesQuery = pageQuery.extend({
  q: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe("Case-insensitive partial match on the GRN, IR or PO number, the supplier's code or name, or the supplier invoice number"),
  status: goodsReceivedNoteStatus.optional(),
  supplierId: supplierId.optional(),
})

// What a client sends for a line: one per product of the order. orderedQuantity is always the order's.
export const goodsReceivedNoteItemInput = z.object({
  productId,
  receivedQuantity: z.number().int().min(0).max(1_000_000).describe("At most what is still outstanding on the order"),
  remarks: z.string().trim().min(1).max(500).nullable().default(null),
})

const goodsReceivedNoteFields = z.object({
  receivedDate: dateOnly,
  supplierInvoiceNumber: z.string().trim().min(1).max(100).nullable(),
  items: z
    .array(goodsReceivedNoteItemInput)
    .min(1, "Add the order's products")
    .max(200)
    .refine((items) => new Set(items.map((item) => item.productId)).size === items.length, "Each product can be on one line only")
    .refine((items) => items.some((item) => item.receivedQuantity > 0), "Receive at least one product")
    .describe("One per product of the order, in any order (lines are numbered as on the order). On update, replaces every line"),
})

export const createGoodsReceivedNoteBody = goodsReceivedNoteFields.extend({
  internalRequisitionId: z
    .number()
    .int()
    .positive()
    .max(2147483647)
    .describe("A local IR whose purchase order is approved, or an approved international IR"),
  receivedDate: goodsReceivedNoteFields.shape.receivedDate.optional().describe("Defaults to today"),
  supplierInvoiceNumber: goodsReceivedNoteFields.shape.supplierInvoiceNumber.default(null),
})

// Pending and rejected only. From the fields without defaults (see the pitfall in AGENTS.md).
export const updateGoodsReceivedNoteBody = goodsReceivedNoteFields.partial()

export const cancelGoodsReceivedNoteBody = z.object({ reason: z.string().trim().min(1, "Give a reason").max(500) })

export type ListGoodsReceivedNotesQuery = z.infer<typeof listGoodsReceivedNotesQuery>
export type GoodsReceivedNoteItemInput = z.infer<typeof goodsReceivedNoteItemInput>
export type CreateGoodsReceivedNoteBody = z.infer<typeof createGoodsReceivedNoteBody>
export type UpdateGoodsReceivedNoteBody = z.infer<typeof updateGoodsReceivedNoteBody>
