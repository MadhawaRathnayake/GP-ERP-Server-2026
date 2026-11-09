import type { Prisma } from "#generated/prisma/client.js"
import { db } from "#core/db.js"
import { BadRequestError, NotFoundError } from "#http/errors.js"
import { paginate } from "#http/pagination.js"
import type { Actor } from "#security/auth.plugin.js"
import { dropdownUsers, isDropdownUser } from "#modules/dropdowns/dropdowns.service.js"
import { DeliveryNoteNotDraftError, ItemVerifierRequiredError, SameVerifierAndIssuerError } from "./delivery-notes.errors.js"
import type { ListDeliveryNotesQuery } from "./delivery-notes.schema.js"

// A note is made as a draft when a sales or warranty invoice is finalized, and cancelled with it (invoices.service.ts).
// Here: a draft gets its item verifier (which can be changed while it's a draft), then its item issuer, a different
// user, which issues it. Both come from their dropdowns (Admin → Dropdowns).

const person = { select: { id: true, name: true } } as const

const summaryInclude = {
  invoice: {
    select: {
      id: true,
      invoiceNumber: true,
      type: true,
      deliveryLocation: true,
      finalizedAt: true,
      customer: { select: { id: true, code: true, name: true } },
    },
  },
  itemVerifier: person,
  itemIssuer: person,
} satisfies Prisma.DeliveryNoteInclude

const detailInclude = {
  ...summaryInclude,
  invoice: {
    select: {
      ...summaryInclude.invoice.select,
      customer: {
        select: {
          id: true,
          code: true,
          name: true,
          email: true,
          phones: true,
          houseNumber: true,
          street: true,
          city: true,
          district: true,
          country: true,
        },
      },
      items: {
        where: { isDeleted: false },
        orderBy: { lineNo: "asc" },
        select: {
          lineNo: true,
          productId: true,
          description: true,
          quantity: true,
          product: { select: { sku: true, title: true, imageUrl: true } },
        },
      },
    },
  },
  creator: person,
} satisfies Prisma.DeliveryNoteInclude

export function listDeliveryNotes({ status, invoiceId, ...page }: ListDeliveryNotesQuery) {
  const where: Prisma.DeliveryNoteWhereInput = { ...(status && { status }), ...(invoiceId && { invoiceId }), isDeleted: false }
  return paginate(
    page,
    (args) => db.deliveryNote.findMany({ where, include: summaryInclude, orderBy: { id: "desc" }, ...args }),
    () => db.deliveryNote.count({ where }),
  )
}

export async function getDeliveryNote(id: number) {
  const note = await db.deliveryNote.findUnique({ where: { id }, include: detailInclude })
  if (!note) throw new NotFoundError("Delivery note", String(id))
  return note
}

/** The users who can be picked as a note's item verifier / item issuer (Admin → Dropdowns). */
export const listItemVerifiers = () => dropdownUsers("ITEM_VERIFIER")
export const listItemIssuers = () => dropdownUsers("ITEM_ISSUER")

/** Sets or changes the item verifier of a draft. */
export async function setItemVerifier(id: number, userId: string, actor: Actor) {
  if (!(await isDropdownUser("ITEM_VERIFIER", userId))) {
    throw new BadRequestError(`User ${userId} isn't one of the item verifiers (Admin → Dropdowns)`)
  }
  // Only while it's a draft; the condition is in the update, so it can't race with issuing.
  const { count } = await db.deliveryNote.updateMany({
    where: { id, status: "draft" },
    data: { itemVerifierId: userId, modifiedBy: actor.id, modifiedAt: new Date() },
  })
  if (count === 0) await refuse(id)
  return getDeliveryNote(id)
}

/** Adds the item issuer, a different user from the verifier, which issues the note. */
export async function setItemIssuer(id: number, userId: string, actor: Actor) {
  if (!(await isDropdownUser("ITEM_ISSUER", userId))) {
    throw new BadRequestError(`User ${userId} isn't one of the item issuers (Admin → Dropdowns)`)
  }
  const now = new Date()
  // `not: userId` also leaves out a note with no verifier (NULL <> x isn't true), so refuse() says which rule failed.
  const { count } = await db.deliveryNote.updateMany({
    where: { id, status: "draft", itemVerifierId: { not: userId } },
    data: { itemIssuerId: userId, status: "issued", issuedAt: now, modifiedBy: actor.id, modifiedAt: now },
  })
  if (count === 0) await refuse(id)
  return getDeliveryNote(id)
}

/** Throws the reason a conditional update changed nothing. */
async function refuse(id: number): Promise<never> {
  const note = await db.deliveryNote.findUnique({ where: { id }, select: { status: true, itemVerifierId: true } })
  if (!note) throw new NotFoundError("Delivery note", String(id))
  if (note.status !== "draft") throw new DeliveryNoteNotDraftError(id)
  if (!note.itemVerifierId) throw new ItemVerifierRequiredError(id)
  throw new SameVerifierAndIssuerError()
}
