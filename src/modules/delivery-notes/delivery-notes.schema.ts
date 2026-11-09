import { z } from "zod"
import { pageQuery, pageResult } from "#http/pagination.js"
import { quotationType } from "#modules/quotations/quotations.schema.js"

const userId = z.string().regex(/^USER\d{5,}$/, "Must be a user id like USER00001")
// Integer ids: anything above 2^31 − 1 can't exist (and would fail in Prisma, not 404).
const intId = z.coerce.number().int().positive().max(2147483647)

export const deliveryNoteIdParams = z.object({ id: intId })

export const deliveryNoteStatus = z
  .enum(["draft", "issued", "cancelled"])
  .describe("draft (made on invoice finalize) → issued (verifier and issuer added); cancelled with its invoice")

const party = z.object({ id: z.string(), name: z.string() })

const invoiceRef = z.object({
  id: z.number().int(),
  invoiceNumber: z.string().nullable(),
  type: quotationType,
  deliveryLocation: z.string().nullable(),
  finalizedAt: z.date().nullable(),
  customer: party.extend({ code: z.string() }),
})

// A list row.
export const deliveryNoteSummary = z.object({
  id: z.number().int(),
  deliveryNoteNumber: z.string().describe("GPDN-1, GPDN-2, …"),
  invoiceId: z.number().int(),
  invoice: invoiceRef,
  status: deliveryNoteStatus,
  itemVerifierId: z.string().nullable(),
  itemVerifier: party.nullable(),
  itemIssuerId: z.string().nullable(),
  itemIssuer: party.nullable(),
  issuedAt: z.date().nullable(),
  createdBy: z.string().nullable(),
  createdAt: z.date(),
  modifiedBy: z.string().nullable(),
  modifiedAt: z.date().nullable(),
  isDeleted: z.boolean(),
})

// The detail also has what goes on the printed note: the customer's contact details and the invoice's products.
export const deliveryNote = deliveryNoteSummary.extend({
  invoice: invoiceRef.extend({
    customer: party.extend({
      code: z.string(),
      email: z.string().nullable(),
      phones: z.array(z.string()),
      houseNumber: z.string().nullable(),
      street: z.string().nullable(),
      city: z.string().nullable(),
      district: z.string().nullable(),
      country: z.string(),
    }),
    items: z.array(
      z.object({
        lineNo: z.number().int(),
        productId: z.string(),
        description: z.string(),
        quantity: z.number().int(),
        product: z.object({ sku: z.string(), title: z.string(), imageUrl: z.string().nullable() }),
      }),
    ),
  }),
  creator: party.nullable(),
})

export const deliveryNotePage = pageResult(deliveryNoteSummary)

export const listDeliveryNotesQuery = pageQuery.extend({
  status: deliveryNoteStatus.optional(),
  invoiceId: intId.optional(),
})

export const setItemVerifierBody = z.object({ userId: userId.describe("One of GET /delivery-notes/item-verifiers") })

export const setItemIssuerBody = z.object({
  userId: userId.describe("One of GET /delivery-notes/item-issuers; not the item verifier"),
})

export type ListDeliveryNotesQuery = z.infer<typeof listDeliveryNotesQuery>
