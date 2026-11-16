import type { Prisma } from "#generated/prisma/client.js"
import { db } from "#core/db.js"
import { NotFoundError } from "#http/errors.js"
import type { Actor } from "#security/auth.plugin.js"
import { SerialItemsNotAvailableError } from "#modules/serial-items/serial-items.errors.js"
import { InvoiceNotDraftError, SerialNotAvailableError, SerialNotFoundError, SerialsMissingError } from "./invoices.errors.js"

// Serial numbers on invoices (docs/plans/serial-numbers.md §3.5). Finance makes the draft; the warehouse scans a unit
// for every unit of each serial-tracked line on it (InvoiceSerialItem, a "pick"), usually on the Zebra TC21. A picked
// unit is reserved for the draft (no other invoice can pick it) but stays in stock. Finalizing needs every unit picked
// and sells them; cancelling gives them back. The functions taking `tx` run inside the invoice service's transaction,
// after it has locked the invoice (and, when stock moves, the products: units are locked after them, as stock
// adjustments do).

type Tx = Prisma.TransactionClient

const livePick = { releasedAt: null, isDeleted: false } as const

/**
 * One scan on a draft: the code is a unit's serial, one of its accessory serials, or a pallet number. The unit (or the
 * pallet's units in stock, up to what each line still needs) is picked for its line. Refused with the reason when it
 * can't be: another product, already scanned, on another invoice, not in stock, or the line is full.
 */
export async function scanSerial(invoiceId: number, code: string, actor: Actor) {
  return db.$transaction(async (tx) => {
    const lines = await lockDraft(tx, invoiceId)
    const serialLines = lines.filter((line) => line.product.trackingType === "serial")
    const key = code.toUpperCase()

    let ids = (
      await tx.$queryRaw<{ id: number }[]>`
        SELECT s.id FROM "SerialItem" s
        WHERE NOT s."isDeleted" AND (
          upper(s."serialNumber") = ${key}
          OR s.id IN (SELECT a."serialItemId" FROM "SerialItemAccessory" a WHERE upper(a."serialNumber") = ${key} AND NOT a."isDeleted")
        )`
    ).map((row) => row.id)
    const isPallet = ids.length === 0
    if (isPallet) {
      const productIds = serialLines.map((line) => line.productId)
      ids = (
        await tx.$queryRaw<{ id: number }[]>`
          SELECT id FROM "SerialItem"
          WHERE NOT "isDeleted" AND "status" = 'inStock' AND upper("palletNumber") = ${key} AND "productId" = ANY(${productIds}::text[])`
      ).map((row) => row.id)
    }
    if (ids.length === 0) throw new SerialNotFoundError(code)

    const units = await tx.serialItem.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        serialNumber: true,
        productId: true,
        status: true,
        product: { select: { sku: true } },
        invoicePicks: { where: livePick, select: { invoiceId: true, invoice: { select: { draftNumber: true, invoiceNumber: true } } } },
      },
      orderBy: { serialNumber: "asc" },
    })
    const picks = await tx.invoiceSerialItem.findMany({ where: { invoiceId, ...livePick }, select: { productId: true } })
    const picked = new Map(serialLines.map((line) => [line.productId, picks.filter((pick) => pick.productId === line.productId).length]))

    const added: typeof units = []
    const problems: string[] = []
    for (const unit of units) {
      const line = serialLines.find((serialLine) => serialLine.productId === unit.productId)
      const pick = unit.invoicePicks[0]
      if (!line) problems.push(`${unit.serialNumber} is ${unit.product.sku}, which isn't on this invoice`)
      else if (pick?.invoiceId === invoiceId) problems.push(`${unit.serialNumber} is already scanned`)
      else if (pick) problems.push(`${unit.serialNumber} is on ${pick.invoice.invoiceNumber ?? pick.invoice.draftNumber}`)
      else if (unit.status !== "inStock") problems.push(`${unit.serialNumber} is ${unit.status === "sold" ? "sold" : "no longer in stock"}`)
      else if ((picked.get(line.productId) ?? 0) >= line.quantity) problems.push(`All ${line.quantity} of ${unit.product.sku} are scanned`)
      else {
        picked.set(line.productId, (picked.get(line.productId) ?? 0) + 1)
        added.push(unit)
      }
    }
    if (added.length === 0) throw new SerialNotAvailableError(isPallet ? `Pallet ${code}: ${problems[0]}` : problems[0]!)

    await tx.invoiceSerialItem.createMany({
      data: added.map((unit) => ({ invoiceId, productId: unit.productId, serialItemId: unit.id, createdBy: actor.id })),
    })
    return {
      added: added.map((unit) => ({ serialItemId: unit.id, serialNumber: unit.serialNumber, sku: unit.product.sku })),
      skipped: problems.length,
    }
  })
}

/** Takes a scanned unit off a draft (a wrong scan). */
export async function releaseSerial(invoiceId: number, serialItemId: number, actor: Actor) {
  await db.$transaction(async (tx) => {
    await lockDraft(tx, invoiceId)
    const { count } = await tx.invoiceSerialItem.updateMany({
      where: { invoiceId, serialItemId, ...livePick },
      data: { releasedAt: new Date(), modifiedBy: actor.id, modifiedAt: new Date() },
    })
    if (count === 0) throw new NotFoundError("Scanned unit", String(serialItemId))
  })
}

/**
 * After a draft's lines are replaced: a product whose line is gone, or now has fewer units than are picked, loses its
 * picks (the warehouse scans it again).
 */
export async function releasePicksBeyondLines(tx: Tx, invoiceId: number, lines: readonly { productId: string; quantity: number }[], actor: Actor) {
  const picks = await tx.invoiceSerialItem.groupBy({ by: ["productId"], where: { invoiceId, ...livePick }, _count: { _all: true } })
  const over = picks
    .filter((pick) => pick._count._all > lines.filter((line) => line.productId === pick.productId).reduce((total, line) => total + line.quantity, 0))
    .map((pick) => pick.productId)
  if (over.length === 0) return
  await release(tx, { invoiceId, productId: { in: over } }, actor)
}

/** Cancelling a draft: its picks are released. */
export const releaseAllPicks = (tx: Tx, invoiceId: number, actor: Actor) => release(tx, { invoiceId }, actor)

/**
 * Finalizing: every serial-tracked line must have exactly its quantity picked (409 SERIALS_MISSING otherwise). The
 * units, still in stock, become sold on the invoice, each with a movement.
 */
export async function sellPickedUnits(
  tx: Tx,
  invoiceId: number,
  invoiceNumber: string,
  lines: readonly { productId: string; quantity: number; product: { sku: string; trackingType: string } }[],
  actor: Actor,
) {
  const picks = await tx.invoiceSerialItem.findMany({ where: { invoiceId, ...livePick }, select: { productId: true, serialItemId: true } })
  const missing = lines
    .filter((line) => line.product.trackingType === "serial")
    .map((line) => ({ sku: line.product.sku, quantity: line.quantity, scanned: picks.filter((pick) => pick.productId === line.productId).length }))
    .filter((line) => line.scanned !== line.quantity)
  if (missing.length > 0) throw new SerialsMissingError(missing)
  if (picks.length === 0) return

  const ids = picks.map((pick) => pick.serialItemId).toSorted((a, b) => a - b)
  await tx.$queryRaw`SELECT id FROM "SerialItem" WHERE id = ANY(${ids}::int[]) ORDER BY id FOR UPDATE`
  const units = await tx.serialItem.findMany({ where: { id: { in: ids } }, select: { id: true, serialNumber: true, status: true } })
  const gone = units.filter((unit) => unit.status !== "inStock")
  if (gone.length > 0) throw new SerialItemsNotAvailableError(gone.map((unit) => unit.serialNumber))

  const now = new Date()
  await tx.serialItem.updateMany({ where: { id: { in: ids } }, data: { status: "sold", invoiceId, modifiedBy: actor.id, modifiedAt: now } })
  await tx.serialItemMovement.createMany({
    data: ids.map((serialItemId) => ({
      serialItemId,
      fromStatus: "inStock" as const,
      toStatus: "sold" as const,
      invoiceId,
      remarks: `Sold on ${invoiceNumber}`,
      createdBy: actor.id,
    })),
  })
}

/** Cancelling a finalized invoice: its units go back into stock, each with a movement, and its picks are released. */
export async function returnSoldUnits(tx: Tx, invoiceId: number, invoiceNumber: string | null, actor: Actor) {
  const units = await tx.serialItem.findMany({ where: { invoiceId, status: "sold" }, select: { id: true }, orderBy: { id: "asc" } })
  if (units.length > 0) {
    const ids = units.map((unit) => unit.id)
    await tx.$queryRaw`SELECT id FROM "SerialItem" WHERE id = ANY(${ids}::int[]) ORDER BY id FOR UPDATE`
    await tx.serialItem.updateMany({
      where: { id: { in: ids } },
      data: { status: "inStock", invoiceId: null, modifiedBy: actor.id, modifiedAt: new Date() },
    })
    await tx.serialItemMovement.createMany({
      data: ids.map((serialItemId) => ({
        serialItemId,
        fromStatus: "sold" as const,
        toStatus: "inStock" as const,
        invoiceId,
        remarks: `${invoiceNumber ?? "Invoice"} cancelled`,
        createdBy: actor.id,
      })),
    })
  }
  await releaseAllPicks(tx, invoiceId, actor)
}

/** Locks a draft invoice and returns its lines. */
async function lockDraft(tx: Tx, invoiceId: number) {
  await tx.$executeRaw`SELECT 1 FROM "Invoice" WHERE id = ${invoiceId} FOR UPDATE`
  const invoice = await tx.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      status: true,
      items: { where: { isDeleted: false }, select: { productId: true, quantity: true, product: { select: { sku: true, trackingType: true } } } },
    },
  })
  if (!invoice) throw new NotFoundError("Invoice", String(invoiceId))
  if (invoice.status !== "draft") throw new InvoiceNotDraftError(invoiceId)
  return invoice.items
}

function release(tx: Tx, where: Prisma.InvoiceSerialItemWhereInput, actor: Actor) {
  const now = new Date()
  return tx.invoiceSerialItem.updateMany({ where: { ...where, ...livePick }, data: { releasedAt: now, modifiedBy: actor.id, modifiedAt: now } })
}
