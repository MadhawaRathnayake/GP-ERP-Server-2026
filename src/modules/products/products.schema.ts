import { z } from "zod"
import { bigintNumber, money } from "#http/fields.js"
import { pageQuery, pageResult } from "#http/pagination.js"
import { unitInput } from "#modules/serial-items/serial-items.schema.js"
import { IMAGE_TYPES, type ImageType } from "./products.images.js"

const productId = z.string().regex(/^PROD\d{6,}$/, "Must be a product id like PROD000001")
const categoryId = z.string().regex(/^CAT\d{4,}$/, "Must be a category id like CAT0001")

export const productIdParams = z.object({ id: productId })

export const trackingType = z.enum(["quantity", "serial"]).describe("quantity = counted only; serial = every unit has a serial number")

export const product = z.object({
  id: z.string(),
  sku: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  categoryId: z.string(),
  manufacturer: z.string().nullable(),
  countryOfOrigin: z.string().nullable(),
  imageUrl: z.string().nullable(),
  documentUrl: z.string().nullable(),
  slug: z.string().nullable(),
  warrantyMonths: z.number().int(),
  price: money,
  cost: money,
  minimumStock: z.number().int(),
  stockInHand: z.number().int().describe("Changes only through GRNs, invoices and POST /products/:id/stock-adjustments"),
  stockVersion: bigintNumber.describe("Goes up with every stock change; set by the database. See GET /api/v1/stock/events"),
  additionalInfo: z.string().nullable(),
  trackingType,
  createdBy: z.string().nullable(),
  createdAt: z.date(),
  modifiedBy: z.string().nullable(),
  modifiedAt: z.date().nullable(),
  isDeleted: z.boolean(),
})

export const productPage = pageResult(product)

export const listProductsQuery = pageQuery.extend({
  sku: z.string().trim().min(1).optional().describe("Case-insensitive partial match on SKU"),
  categoryId: categoryId.optional(),
  includeDeleted: z.stringbool().default(false).describe("Include deleted products"),
})

const amount = money.refine((value) => value.gte(0), "Must be 0 or more")

// Changing price or cost also records a Price/CostMovement (products.service.ts). Stock isn't here: a new product starts
// at 0, and stock changes through documents and stock adjustments only.
const productFields = z.object({
  sku: z.string().trim().min(1).max(64),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(5000).nullable(),
  categoryId,
  manufacturer: z.string().trim().min(1).max(200).nullable(),
  countryOfOrigin: z.string().trim().min(1).max(100).nullable(),
  imageUrl: z.url().nullable(),
  documentUrl: z.url().nullable(),
  slug: z.string().trim().min(1).max(200).nullable(),
  warrantyMonths: z.number().int().nonnegative(),
  price: amount,
  cost: amount,
  minimumStock: z.number().int().nonnegative(),
  additionalInfo: z.string().trim().min(1).max(5000).nullable(),
  trackingType,
})

export const createProductBody = productFields.extend({
  description: productFields.shape.description.default(null),
  manufacturer: productFields.shape.manufacturer.default(null),
  countryOfOrigin: productFields.shape.countryOfOrigin.default(null),
  imageUrl: productFields.shape.imageUrl.default(null),
  documentUrl: productFields.shape.documentUrl.default(null),
  slug: productFields.shape.slug.default(null),
  price: amount.prefault(0),
  cost: amount.prefault(0),
  minimumStock: productFields.shape.minimumStock.default(0),
  additionalInfo: productFields.shape.additionalInfo.default(null),
})

// From the fields without defaults: `createProductBody.partial()` would keep them, so a PATCH that only renames a
// product would reset its description and price.
export const updateProductBody = productFields
  .extend({ isDeleted: z.boolean().describe("true = deleted: hidden from lists by default") })
  .partial()

// Stock added or removed by hand (PRODUCTS.ADJUST_STOCK), with exactly one of: `quantity` for a quantity-tracked
// product; `add` / `remove` / `register` for a serial-tracked one, whose stock moves with its units
// (docs/plans/serial-numbers.md §3.2).
export const stockAdjustmentBody = z
  .object({
    reason: z.string().trim().min(1).max(500).describe("Why, e.g. a stock count; kept on the stock movement"),
    quantity: z
      .number()
      .int()
      .refine((value) => value !== 0, "Must not be 0")
      .optional()
      .describe("Quantity-tracked: signed, + adds to stock in hand, - takes from it (not below 0)"),
    add: z.array(unitInput).min(1).max(500).optional().describe("Serial-tracked: new units; stock goes up by as many"),
    remove: z
      .array(z.number().int().positive())
      .min(1)
      .max(500)
      .optional()
      .describe("Serial-tracked: ids of units in stock to take out; stock goes down by as many"),
    register: z
      .array(unitInput)
      .min(1)
      .max(500)
      .optional()
      .describe("Serial-tracked: serials for stock already counted without them (old stock); stock doesn't change"),
  })
  .refine(
    (body) => [body.quantity, body.add, body.remove, body.register].filter((value) => value !== undefined).length === 1,
    "Send exactly one of quantity, add, remove or register",
  )

export const imageUploadBody = z.object({
  contentType: z.enum(Object.keys(IMAGE_TYPES) as [ImageType, ...ImageType[]]),
})

export const imageUpload = z.object({
  uploadUrl: z.url().describe("PUT the file here with the same Content-Type header; expires after expiresIn seconds"),
  publicUrl: z.url().describe("Save this as the product's imageUrl once the upload succeeds"),
  expiresIn: z.number().int(),
})

export type ListProductsQuery = z.infer<typeof listProductsQuery>
export type CreateProductBody = z.infer<typeof createProductBody>
export type UpdateProductBody = z.infer<typeof updateProductBody>
export type StockAdjustmentBody = z.infer<typeof stockAdjustmentBody>
