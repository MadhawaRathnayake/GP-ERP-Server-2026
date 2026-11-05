import { z } from "zod"
import { bigintNumber } from "#http/fields.js"

/** One product's current stock: the same fields as on the product. */
export const stockLevel = z.object({
  id: z.string().describe("Product id"),
  stockInHand: z.number().int(),
  stockPreOrder: z.number().int(),
  stockInTransit: z.number().int(),
  stockOnArrival: z.number().int(),
  stockVersion: bigintNumber.describe(
    "Goes up with every stock change of any product. Of two values for the same product, the higher stockVersion is newer",
  ),
})

export const stockLevels = z.array(stockLevel)

export type StockLevel = z.infer<typeof stockLevel>
