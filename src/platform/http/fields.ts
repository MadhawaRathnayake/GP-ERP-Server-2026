import { z } from "zod"
import { Prisma } from "#generated/prisma/client.js"

// Reusable zod field types, so services can return Prisma rows as-is (no mapping to DTOs).
//
//   Dates:  use z.date() in response schemas — sent as ISO strings, documented as date-time.
//   Money:  use money — Prisma Decimal ↔ JSON number.

/** Prisma Decimal column. Responses send a JSON number; request bodies accept a number and give you a Decimal. */
export const money = z
  .codec(z.number(), z.instanceof(Prisma.Decimal), {
    decode: (n) => new Prisma.Decimal(n),
    encode: (d) => d.toNumber(),
  })
  .meta({ type: "number", example: 1250.5 })

/** `:id` route param for uuid primary keys. */
export const idParams = z.object({ id: z.uuid() })
