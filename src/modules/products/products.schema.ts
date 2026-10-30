import { z } from "zod"
import { pageQuery, pageResult } from "#http/pagination.js"
import { IMAGE_TYPES, type ImageType } from "./products.images.js"

const productId = z.string().regex(/^PROD\d{6,}$/, "Must be a product id like PROD000001")
const categoryId = z.string().regex(/^CAT\d{4,}$/, "Must be a category id like CAT0001")

export const productIdParams = z.object({ id: productId })

export const trackingType = z.enum(["quantity", "serial"]).describe("quantity = counted only; serial = every unit has a serial number")

export const product = z.object({
  id: z.string(),
  sku: z.string(),
  title: z.string(),
  description: z.string(),
  categoryId: z.string(),
  manufacturer: z.string().nullable(),
  countryOfOrigin: z.string().nullable(),
  imageUrl: z.string().nullable(),
  documentUrl: z.string().nullable(),
  slug: z.string().nullable(),
  warrantyMonths: z.number().int(),
  minimumStock: z.number().int(),
  stockInHand: z.number().int(),
  stockPreOrder: z.number().int(),
  stockInTransit: z.number().int(),
  stockOnArrival: z.number().int(),
  // z.unknown(): Prisma's JsonValue doesn't fit z.json()'s type. It's always an object or null (see productFields).
  additionalInfo: z.unknown().meta({ type: ["object", "null"] }),
  trackingType,
  createdBy: z.string().nullable(),
  createdAt: z.date(),
  modifiedBy: z.string().nullable(),
  modifiedAt: z.date().nullable(),
  isActive: z.boolean(),
})

export const productPage = pageResult(product)

export const listProductsQuery = pageQuery.extend({
  sku: z.string().trim().min(1).optional().describe("Case-insensitive partial match on SKU"),
  categoryId: categoryId.optional(),
  includeInactive: z.stringbool().default(false).describe("Include deactivated (deleted) products"),
})

// The stock columns aren't here: they're running totals of StockMovement, never set directly.
const productFields = z.object({
  sku: z.string().trim().min(1).max(64),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000),
  categoryId,
  manufacturer: z.string().trim().min(1).max(200).nullable(),
  countryOfOrigin: z.string().trim().min(1).max(100).nullable(),
  imageUrl: z.url().nullable(),
  documentUrl: z.url().nullable(),
  slug: z.string().trim().min(1).max(200).nullable(),
  warrantyMonths: z.number().int().nonnegative(),
  minimumStock: z.number().int().nonnegative(),
  additionalInfo: z.record(z.string(), z.json()).nullable().describe("Free-form attributes, stored as jsonb"),
  trackingType,
})

export const createProductBody = productFields.extend({
  description: productFields.shape.description.default("N/A"),
  manufacturer: productFields.shape.manufacturer.default(null),
  countryOfOrigin: productFields.shape.countryOfOrigin.default(null),
  imageUrl: productFields.shape.imageUrl.default(null),
  documentUrl: productFields.shape.documentUrl.default(null),
  slug: productFields.shape.slug.default(null),
  minimumStock: productFields.shape.minimumStock.default(0),
  additionalInfo: productFields.shape.additionalInfo.default(null),
})

// From the fields without defaults: `createProductBody.partial()` would keep them, so a PATCH that only renames a
// product would reset its description and minimum stock.
export const updateProductBody = productFields
  .extend({ isActive: z.boolean().describe("false = deleted: hidden from lists by default") })
  .partial()

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
