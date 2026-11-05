import { z } from "zod"
import { Prisma } from "#generated/prisma/client.js"

// Reusable zod field types, so services can return Prisma rows as-is (no mapping to DTOs).
//
//   Dates:  use z.date() in response schemas — sent as ISO strings, documented as date-time.
//   Money:  use money — Prisma Decimal ↔ JSON number.
//   Counters: use bigintNumber — Prisma BigInt ↔ JSON number.

/** Prisma Decimal column. Responses send a JSON number; request bodies accept a number and give you a Decimal. */
export const money = z
  .codec(z.number(), z.instanceof(Prisma.Decimal), {
    decode: (n) => new Prisma.Decimal(n),
    encode: (d) => d.toNumber(),
  })
  .meta({ type: "number", example: 1250.5 })

/** Prisma BigInt counter (e.g. Product.stockVersion). Sent as a JSON number, which is exact up to 2^53. */
export const bigintNumber = z
  .codec(z.number().int().nonnegative(), z.bigint(), {
    decode: (n) => BigInt(n),
    encode: (b) => Number(b),
  })
  .meta({ type: "integer", example: 1042 })

/** `:id` route param for uuid primary keys. */
export const idParams = z.object({ id: z.uuid() })
