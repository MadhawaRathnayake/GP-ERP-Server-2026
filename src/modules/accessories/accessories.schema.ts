import { z } from "zod"

export const accessoryId = z.string().regex(/^ACC\d{4,}$/, "Must be an accessory id like ACC0001")
const productId = z.string().regex(/^PROD\d{6,}$/, "Must be a product id like PROD000001")

export const accessoryIdParams = z.object({ id: accessoryId })

export const accessory = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  productId: z.string().nullable().describe("The product it is when sold on its own, if any (reference only)"),
  product: z.object({ id: z.string(), sku: z.string(), title: z.string() }).nullable(),
  createdBy: z.string().nullable(),
  createdAt: z.date(),
  modifiedBy: z.string().nullable(),
  modifiedAt: z.date().nullable(),
  isDeleted: z.boolean(),
})

export const accessoryList = z.array(accessory)

export const listAccessoriesQuery = z.object({
  includeDeleted: z.stringbool().default(false).describe("Include deleted accessories"),
})

const accessoryFields = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500),
  productId: productId.nullable(),
})

export const createAccessoryBody = accessoryFields.extend({
  description: accessoryFields.shape.description.default(""),
  productId: accessoryFields.shape.productId.default(null),
})

// From the fields without defaults (see the pitfall in AGENTS.md).
export const updateAccessoryBody = accessoryFields
  .extend({ isDeleted: z.boolean().describe("true = deleted: hidden from lists by default") })
  .partial()

// What comes with every unit of a product.
export const productAccessory = z.object({
  accessoryId: z.string(),
  accessory: z.object({ id: z.string(), name: z.string(), isDeleted: z.boolean() }),
  quantity: z.number().int().describe("Per unit"),
})

export const productAccessoryList = z.array(productAccessory)

export const setProductAccessoriesBody = z.object({
  items: z
    .array(z.object({ accessoryId, quantity: z.number().int().min(1).max(20) }))
    .max(20)
    .refine((items) => new Set(items.map((item) => item.accessoryId)).size === items.length, "List each accessory once")
    .describe("The whole list; replaces the saved one"),
})

export type ListAccessoriesQuery = z.infer<typeof listAccessoriesQuery>
export type CreateAccessoryBody = z.infer<typeof createAccessoryBody>
export type UpdateAccessoryBody = z.infer<typeof updateAccessoryBody>
export type SetProductAccessoriesBody = z.infer<typeof setProductAccessoriesBody>
