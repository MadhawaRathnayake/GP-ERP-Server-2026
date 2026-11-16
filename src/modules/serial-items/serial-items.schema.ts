import { z } from "zod"
import { pageQuery, pageResult } from "#http/pagination.js"
import { accessoryId } from "#modules/accessories/accessories.schema.js"

// Serial numbers are stored exactly as the product carries them (digits, letters in either case, "-"), trimmed, and
// are unique across all units ignoring case (docs/plans/serial-numbers.md).
export const serialNumberText = z.string().trim().min(1).max(100)

export const serialItemStatus = z.enum(["inStock", "sold", "usedForRepair", "removed"])

export const serialItemIdParams = z.object({ id: z.coerce.number().int().positive() })

/** A new unit, as scanned: its serial, optional pallet, and the serials of the accessories that came with it. */
export const unitInput = z.object({
  serialNumber: serialNumberText,
  palletNumber: serialNumberText.nullable().default(null),
  accessories: z.array(z.object({ accessoryId, serialNumber: serialNumberText })).max(20).default([]),
})

const person = z.object({ id: z.string(), name: z.string() })

export const serialItemSummary = z.object({
  id: z.number().int(),
  serialNumber: z.string(),
  palletNumber: z.string().nullable(),
  status: serialItemStatus,
  productId: z.string(),
  product: z.object({ id: z.string(), sku: z.string(), title: z.string() }),
  invoiceId: z.number().int().nullable(),
  invoice: z.object({ id: z.number().int(), invoiceNumber: z.string().nullable() }).nullable().describe("The invoice it is sold on"),
  accessories: z.array(z.object({ serialNumber: z.string(), accessory: z.object({ id: z.string(), name: z.string() }) })),
  createdAt: z.date(),
})

export const serialItemPage = pageResult(serialItemSummary)

export const serialItem = serialItemSummary.extend({
  goodsReceivedNoteDeliveryId: z.number().int().nullable(),
  invoice: z
    .object({
      id: z.number().int(),
      invoiceNumber: z.string().nullable(),
      finalizedAt: z.date().nullable(),
      customer: z.object({ id: z.string(), code: z.string(), name: z.string() }),
    })
    .nullable(),
  movements: z.array(
    z.object({
      id: z.number().int(),
      fromStatus: serialItemStatus.nullable(),
      toStatus: serialItemStatus,
      goodsReceivedNoteDeliveryId: z.number().int().nullable(),
      invoice: z.object({ id: z.number().int(), invoiceNumber: z.string().nullable() }).nullable(),
      remarks: z.string().nullable(),
      creator: person.nullable(),
      createdAt: z.date(),
    }),
  ),
  creator: person.nullable(),
  modifiedAt: z.date().nullable(),
})

export const listSerialItemsQuery = pageQuery.extend({
  search: z.string().trim().min(1).optional().describe("Part of a serial, an accessory serial or a pallet number"),
  productId: z.string().optional(),
  status: serialItemStatus.optional(),
})

export const checkSerialNumbersBody = z.object({ serialNumbers: z.array(serialNumberText).min(1).max(500) })

export const serialNumberCheck = z.array(
  z.object({
    serialNumber: z.string(),
    result: z.enum(["new", "repeated", "exists"]).describe("repeated = earlier in this list; exists = already a unit or an accessory serial"),
    existing: z.object({ serialItemId: z.number().int(), sku: z.string() }).nullable(),
  }),
)

export const updateSerialItemBody = z
  .object({
    serialNumber: serialNumberText,
    palletNumber: serialNumberText.nullable(),
    accessories: unitInput.shape.accessories.unwrap().describe("The whole list; replaces the saved one"),
  })
  .partial()

export const stockCheck = z.array(
  z.object({
    productId: z.string(),
    sku: z.string(),
    title: z.string(),
    stockInHand: z.number().int(),
    unitsInStock: z.number().int(),
    withoutSerial: z.number().int().describe("stockInHand − unitsInStock: old stock still to register (below 0 = more units than stock)"),
  }),
)

export type UnitInput = z.infer<typeof unitInput>
export type ListSerialItemsQuery = z.infer<typeof listSerialItemsQuery>
export type UpdateSerialItemBody = z.infer<typeof updateSerialItemBody>
