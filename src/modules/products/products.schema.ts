import { z } from "zod"
import { money } from "#http/fields.js"
import { pageQuery, pageResult } from "#http/pagination.js"

export const productStatus = z.enum(["active", "inactive"])

export const product = z.object({
  id: z.uuid(),
  sku: z.string(),
  name: z.string(),
  status: productStatus,
  price: money,
  cost: money,
  stock: z.number().int(),
  stockInTransit: z.number().int(),
  stockSold: z.number().int(),
  createdBy: z.string().nullable(),
  createdAt: z.date(),
  modifiedBy: z.string().nullable(),
  modifiedAt: z.date().nullable(),
  isActive: z.boolean(),
})

export const productPage = pageResult(product)

export const listProductsQuery = pageQuery.extend({
  sku: z.string().trim().min(1).optional().describe("Case-insensitive partial match on SKU"),
  includeInactive: z.stringbool().default(false).describe("Include deactivated (deleted) products"),
})

const productFields = z.object({
  sku: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(200),
  status: productStatus,
  price: money,
  cost: money,
  stock: z.number().int().nonnegative(),
  stockInTransit: z.number().int().nonnegative(),
  stockSold: z.number().int().nonnegative(),
})

export const createProductBody = productFields.extend({
  status: productStatus.default("active"),
  stock: productFields.shape.stock.default(0),
  stockInTransit: productFields.shape.stockInTransit.default(0),
  stockSold: productFields.shape.stockSold.default(0),
})

// From the fields without defaults: `createProductBody.partial()` would keep them, so a PATCH that only renames a
// product would reset its status and stock.
export const updateProductBody = productFields
  .extend({ isActive: z.boolean().describe("false = deleted: hidden from lists by default") })
  .partial()

export type ListProductsQuery = z.infer<typeof listProductsQuery>
export type CreateProductBody = z.infer<typeof createProductBody>
export type UpdateProductBody = z.infer<typeof updateProductBody>
