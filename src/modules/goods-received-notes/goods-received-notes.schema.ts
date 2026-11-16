import { z } from "zod"
import { pageQuery, pageResult } from "#http/pagination.js"
import { purchaseOrderStatus } from "#modules/purchase-orders/purchase-orders.schema.js"
import { dateOnly } from "#modules/quotations/quotations.schema.js"
import { unitInput } from "#modules/serial-items/serial-items.schema.js"

const supplierId = z.string().regex(/^SUP\d{5,}$/, "Must be a supplier id like SUP00001")
const productId = z.string().regex(/^PROD\d{6,}$/, "Must be a product id like PROD000001")
// Integer ids: anything above 2^31 − 1 can't exist (and would fail in Prisma, not 404).
const intId = z.coerce.number().int().positive().max(2147483647)

export const goodsReceivedNoteIdParams = z.object({ id: intId })

export const orderParams = z.object({ internalRequisitionId: intId })

export const goodsReceivedNoteStatus = z
  .enum(["partiallyCompleted", "needSerialNumbers", "completed"])
  .describe(
    "Worked out by the server: needSerialNumbers while a serial-tracked line has fewer units than it received, else " +
      "partiallyCompleted while something ordered is still to come, else completed",
  )

const party = z.object({ id: z.string(), name: z.string() })
const product = z.object({
  sku: z.string(),
  title: z.string(),
  imageUrl: z.string().nullable(),
  trackingType: z.enum(["quantity", "serial"]),
})

export const goodsReceivedNoteItem = z.object({
  id: z.number().int(),
  lineNo: z.number().int(),
  productId: z.string(),
  product,
  orderedQuantity: z.number().int().describe("The order line's quantity (the PO's, or the international IR's)"),
  receivedQuantity: z.number().int().describe("Received so far, over every delivery"),
  outstandingQuantity: z.number().int().describe("orderedQuantity − receivedQuantity, at least 0"),
  serialsEntered: z.number().int().describe("Serial-tracked: units entered so far (0 for a quantity-tracked line)"),
  serialsMissing: z
    .number()
    .int()
    .describe("Serial-tracked: the serials still to add, receivedQuantity − serialsEntered, leaving out imported deliveries"),
})

export const goodsReceivedNoteDelivery = z.object({
  id: z.number().int(),
  deliveryNo: z.number().int(),
  receivedDate: dateOnly,
  supplierInvoiceNumber: z.string().nullable(),
  remarks: z.string().nullable(),
  isImported: z.boolean().describe("Recorded in the old system: already in stock there, so its units aren't asked for serials"),
  items: z.array(
    z.object({
      productId: z.string(),
      product: z.object({ sku: z.string(), title: z.string() }),
      quantity: z.number().int(),
      remarks: z.string().nullable(),
    }),
  ),
  creator: party.nullable(),
  createdAt: z.date(),
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
  status: goodsReceivedNoteStatus,
  deliveries: z
    .array(z.object({ deliveryNo: z.number().int(), receivedDate: dateOnly, supplierInvoiceNumber: z.string().nullable() }))
    .describe("Its deliveries, oldest first"),
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
  deliveries: z.array(goodsReceivedNoteDelivery),
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
        receivedQuantity: z.number().int().describe("Received so far on the order's GRN"),
        outstandingQuantity: z.number().int().describe("orderedQuantity − receivedQuantity"),
      }),
    )
    .describe("The PO's lines (local IR; none until it has one) or the IR's (international), in order"),
  goodsReceivedNote: z
    .object({ id: z.number().int(), grnNumber: z.string(), status: goodsReceivedNoteStatus })
    .nullable()
    .describe("The order's GRN, once its first delivery is recorded"),
  blockedReason: z.string().nullable().describe("Why a delivery can't be recorded for the order now; null when it can"),
})

export const listGoodsReceivedNotesQuery = pageQuery.extend({
  q: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe("Case-insensitive partial match on the GRN, IR or PO number, the supplier's code or name, or a supplier invoice number"),
  status: goodsReceivedNoteStatus.optional(),
  supplierId: supplierId.optional(),
})

// What a client sends for a delivery: what came of each product (0 or more; lines with 0 aren't stored).
export const deliveryItemInput = z.object({
  productId,
  quantity: z.number().int().min(0).max(1_000_000).describe("At most what is still outstanding on the order"),
  remarks: z.string().trim().min(1).max(500).nullable().default(null),
})

export const deliveryBody = z.object({
  receivedDate: dateOnly.optional().describe("Defaults to today"),
  supplierInvoiceNumber: z.string().trim().min(1).max(100).nullable().default(null),
  remarks: z.string().trim().min(1).max(500).nullable().default(null),
  items: z
    .array(deliveryItemInput)
    .min(1, "Add what came")
    .max(200)
    .refine((items) => new Set(items.map((item) => item.productId)).size === items.length, "Each product can be on one line only")
    .refine((items) => items.some((item) => item.quantity > 0), "Receive at least one product"),
})

export const createGoodsReceivedNoteBody = deliveryBody.extend({
  internalRequisitionId: z
    .number()
    .int()
    .positive()
    .max(2147483647)
    .describe("A local IR whose purchase order is approved, or an approved international IR, with no GRN yet"),
})

export const addSerialsBody = z.object({
  productId,
  units: z
    .array(unitInput)
    .min(1)
    .max(500)
    .describe("New units of a serial-tracked line, at most its serials still missing; each goes into stock"),
})

export type ListGoodsReceivedNotesQuery = z.infer<typeof listGoodsReceivedNotesQuery>
export type DeliveryBody = z.infer<typeof deliveryBody>
export type CreateGoodsReceivedNoteBody = z.infer<typeof createGoodsReceivedNoteBody>
export type AddSerialsBody = z.infer<typeof addSerialsBody>
