import type { Prisma } from "#generated/prisma/client.js"
import { db } from "#core/db.js"
import { BadRequestError, NotFoundError } from "#http/errors.js"
import { paginate } from "#http/pagination.js"
import type { Actor } from "#security/auth.plugin.js"
import { SerialItemsNotAvailableError, SerialNumbersTakenError } from "./serial-items.errors.js"
import type { ListSerialItemsQuery, UnitInput, UpdateSerialItemBody } from "./serial-items.schema.js"

// Units of serial-tracked products (docs/plans/serial-numbers.md). A unit is registered in stock (a GRN delivery or a
// stock adjustment), sold by a finalized invoice and back in stock if it is cancelled, or removed by an adjustment;
// every change is a SerialItemMovement. A product's stock in hand moves with its units, in the same transaction, by
// the module that registers, sells or removes them. Serial numbers (units' and accessories') are unique across
// everything, ignoring case: the database enforces it per table, this module across both (under a per-serial lock,
// assertSerialsFree).

const summarySelect = {
  id: true,
  serialNumber: true,
  palletNumber: true,
  status: true,
  productId: true,
  product: { select: { id: true, sku: true, title: true } },
  invoiceId: true,
  invoice: { select: { id: true, invoiceNumber: true } },
  accessories: {
    where: { isDeleted: false },
    select: { serialNumber: true, accessory: { select: { id: true, name: true } } },
    orderBy: { id: "asc" },
  },
  createdAt: true,
} satisfies Prisma.SerialItemSelect

const person = { select: { id: true, name: true } } as const

const detailSelect = {
  ...summarySelect,
  goodsReceivedNoteDeliveryId: true,
  // The detail's invoice also has its customer.
  invoice: {
    select: { id: true, invoiceNumber: true, finalizedAt: true, customer: { select: { id: true, code: true, name: true } } },
  },
  movements: {
    where: { isDeleted: false },
    select: {
      id: true,
      fromStatus: true,
      toStatus: true,
      goodsReceivedNoteDeliveryId: true,
      invoice: { select: { id: true, invoiceNumber: true } },
      remarks: true,
      creator: person,
      createdAt: true,
    },
    orderBy: { id: "asc" },
  },
  creator: person,
  modifiedAt: true,
} satisfies Prisma.SerialItemSelect

export function listSerialItems({ search, productId, status, ...page }: ListSerialItemsQuery) {
  const contains = search && { contains: search, mode: "insensitive" as const }
  const where: Prisma.SerialItemWhereInput = {
    isDeleted: false,
    ...(productId && { productId }),
    ...(status && { status }),
    ...(contains && {
      OR: [
        { serialNumber: contains },
        { palletNumber: contains },
        { accessories: { some: { serialNumber: contains, isDeleted: false } } },
      ],
    }),
  }
  return paginate(
    page,
    (args) => db.serialItem.findMany({ where, select: summarySelect, orderBy: { id: "desc" }, ...args }),
    () => db.serialItem.count({ where }),
  )
}

export async function getSerialItem(id: number) {
  const item = await db.serialItem.findFirst({ where: { id, isDeleted: false }, select: detailSelect })
  if (!item) throw new NotFoundError("Serial item", String(id))
  return item
}

/** For each serial, in order: new, repeated earlier in the list, or already used (by a unit or an accessory). */
export async function checkSerialNumbers(serialNumbers: string[]) {
  const used = await usedSerials(db, serialNumbers)
  const seen = new Set<string>()
  return serialNumbers.map((serialNumber) => {
    const key = serialNumber.toUpperCase()
    const existing = used.get(key) ?? null
    const result = existing ? "exists" : seen.has(key) ? "repeated" : "new"
    seen.add(key)
    return { serialNumber, result, existing } as const
  })
}

/** Corrects a unit's serial, pallet or accessory serials (a typo), recorded as a movement. */
export async function updateSerialItem(id: number, data: UpdateSerialItemBody, actor: Actor) {
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT 1 FROM "SerialItem" WHERE id = ${id} FOR UPDATE`
    const before = await tx.serialItem.findFirst({
      where: { id, isDeleted: false },
      select: { serialNumber: true, palletNumber: true, status: true, accessories: { where: { isDeleted: false }, select: { id: true, serialNumber: true } } },
    })
    if (!before) throw new NotFoundError("Serial item", String(id))

    const changes: string[] = []
    const now = new Date()
    const newSerials = [
      ...(data.serialNumber !== undefined && data.serialNumber !== before.serialNumber ? [data.serialNumber] : []),
      ...(data.accessories ?? []).map((accessory) => accessory.serialNumber),
    ]
    await assertSerialsFree(tx, newSerials, { serialItemId: id })
    if (data.accessories) await assertActiveAccessories(tx, data.accessories)

    if (data.serialNumber !== undefined && data.serialNumber !== before.serialNumber) {
      changes.push(`Serial corrected: ${before.serialNumber} → ${data.serialNumber}`)
    }
    if (data.palletNumber !== undefined && data.palletNumber !== before.palletNumber) {
      changes.push(`Pallet: ${before.palletNumber ?? "—"} → ${data.palletNumber ?? "—"}`)
    }
    await tx.serialItem.update({
      where: { id },
      data: { serialNumber: data.serialNumber, palletNumber: data.palletNumber, modifiedBy: actor.id, modifiedAt: now },
    })
    if (data.accessories) {
      const old = before.accessories.map((accessory) => accessory.serialNumber).join(", ") || "—"
      const next = data.accessories.map((accessory) => accessory.serialNumber).join(", ") || "—"
      if (old !== next) changes.push(`Accessories: ${old} → ${next}`)
      await tx.serialItemAccessory.updateMany({
        where: { serialItemId: id, isDeleted: false },
        data: { isDeleted: true, modifiedBy: actor.id, modifiedAt: now },
      })
      await tx.serialItemAccessory.createMany({
        data: data.accessories.map((accessory) => ({ serialItemId: id, ...accessory, createdBy: actor.id })),
      })
    }
    if (changes.length > 0) {
      await tx.serialItemMovement.create({
        data: { serialItemId: id, fromStatus: before.status, toStatus: before.status, remarks: changes.join("; "), createdBy: actor.id },
      })
    }
  })
  return getSerialItem(id)
}

/**
 * Serial products whose stock in hand isn't their units in stock: old stock without serials (withoutSerial > 0, to
 * register), or more units than stock (below 0, a mistake to fix with an adjustment).
 */
export async function stockCheck() {
  const [products, counts] = await Promise.all([
    db.product.findMany({
      where: { trackingType: "serial", isDeleted: false },
      select: { id: true, sku: true, title: true, stockInHand: true },
    }),
    db.serialItem.groupBy({ by: ["productId"], where: { status: "inStock", isDeleted: false }, _count: { _all: true } }),
  ])
  const units = new Map(counts.map((count) => [count.productId, count._count._all]))
  return products
    .map(({ id, sku, title, stockInHand }) => {
      const unitsInStock = units.get(id) ?? 0
      return { productId: id, sku, title, stockInHand, unitsInStock, withoutSerial: stockInHand - unitsInStock }
    })
    .filter((row) => row.withoutSerial !== 0)
    .sort((a, b) => Math.abs(b.withoutSerial) - Math.abs(a.withoutSerial))
}

// ─── For the modules that move units (products' stock adjustments, GRNs, invoices), inside their transaction ───

/** The product's units in stock. */
export function countUnitsInStock(tx: Prisma.TransactionClient, productId: string) {
  return tx.serialItem.count({ where: { productId, status: "inStock", isDeleted: false } })
}

/**
 * Registers new units of a product in stock, with their accessories and a movement each. Refuses serials already used
 * or repeated in the list (409 SERIAL_NUMBERS_TAKEN). Stock in hand is the caller's to change.
 */
export async function addUnits(
  tx: Prisma.TransactionClient,
  productId: string,
  units: readonly UnitInput[],
  { goodsReceivedNoteDeliveryId = null, remarks }: { goodsReceivedNoteDeliveryId?: number | null; remarks: string },
  actor: Actor,
) {
  await assertSerialsFree(tx, units.flatMap((unit) => [unit.serialNumber, ...unit.accessories.map((accessory) => accessory.serialNumber)]))
  await assertActiveAccessories(tx, units.flatMap((unit) => unit.accessories))

  const created = await tx.serialItem.createManyAndReturn({
    data: units.map(({ serialNumber, palletNumber }) => ({
      productId,
      serialNumber,
      palletNumber,
      goodsReceivedNoteDeliveryId,
      createdBy: actor.id,
    })),
    select: { id: true, serialNumber: true },
  })
  const idOf = new Map(created.map((item) => [item.serialNumber.toUpperCase(), item.id]))
  await tx.serialItemMovement.createMany({
    data: created.map((item) => ({ serialItemId: item.id, toStatus: "inStock" as const, goodsReceivedNoteDeliveryId, remarks, createdBy: actor.id })),
  })
  await tx.serialItemAccessory.createMany({
    data: units.flatMap((unit) =>
      unit.accessories.map((accessory) => ({
        serialItemId: idOf.get(unit.serialNumber.toUpperCase())!,
        ...accessory,
        createdBy: actor.id,
      })),
    ),
  })
  return created
}

/**
 * Takes units of a product out of stock (→ removed), with a movement each. Refuses ones that aren't in stock or aren't
 * this product's (409 SERIAL_ITEMS_NOT_AVAILABLE). Stock in hand is the caller's to change.
 */
export async function removeUnits(
  tx: Prisma.TransactionClient,
  productId: string,
  serialItemIds: readonly number[],
  remarks: string,
  actor: Actor,
) {
  const units = await lockUnits(tx, productId, serialItemIds)
  const now = new Date()
  await tx.serialItem.updateMany({
    where: { id: { in: units.map((unit) => unit.id) } },
    data: { status: "removed", modifiedBy: actor.id, modifiedAt: now },
  })
  await tx.serialItemMovement.createMany({
    data: units.map((unit) => ({ serialItemId: unit.id, fromStatus: "inStock" as const, toStatus: "removed" as const, remarks, createdBy: actor.id })),
  })
}

/** Locks the units (id order) and checks they are this product's and in stock. */
export async function lockUnits(tx: Prisma.TransactionClient, productId: string, serialItemIds: readonly number[]) {
  const ids = [...new Set(serialItemIds)].toSorted((a, b) => a - b)
  if (ids.length !== serialItemIds.length) throw new BadRequestError("A unit is listed twice")
  if (ids.length === 0) return []
  await tx.$queryRaw`SELECT id FROM "SerialItem" WHERE id = ANY(${ids}::int[]) ORDER BY id FOR UPDATE`
  const units = await tx.serialItem.findMany({
    where: { id: { in: ids }, isDeleted: false },
    select: { id: true, serialNumber: true, productId: true, status: true },
  })
  const unavailable = ids.filter((id) => {
    const unit = units.find((u) => u.id === id)
    return !unit || unit.productId !== productId || unit.status !== "inStock"
  })
  if (unavailable.length > 0) {
    throw new SerialItemsNotAvailableError(unavailable.map((id) => units.find((u) => u.id === id)?.serialNumber ?? `#${id}`))
  }
  return units
}

// ─── Helpers ───

type Reader = Prisma.TransactionClient | typeof db

/** Serials (upper case) already used by a unit or an accessory, with the unit they belong to. */
async function usedSerials(reader: Reader, serialNumbers: readonly string[], except?: { serialItemId: number }) {
  const keys = [...new Set(serialNumbers.map((serial) => serial.toUpperCase()))]
  const used = new Map<string, { serialItemId: number; sku: string }>()
  if (keys.length === 0) return used
  const rows = await reader.$queryRaw<{ key: string; serialItemId: number; sku: string }[]>`
    SELECT upper(s."serialNumber") AS key, s.id AS "serialItemId", p.sku
    FROM "SerialItem" s JOIN "Product" p ON p.id = s."productId"
    WHERE upper(s."serialNumber") = ANY(${keys}::text[]) AND NOT s."isDeleted"
    UNION ALL
    SELECT upper(a."serialNumber"), s.id, p.sku
    FROM "SerialItemAccessory" a JOIN "SerialItem" s ON s.id = a."serialItemId" JOIN "Product" p ON p.id = s."productId"
    WHERE upper(a."serialNumber") = ANY(${keys}::text[]) AND NOT a."isDeleted"`
  for (const row of rows) {
    // A unit's own serials don't count against a correction of that unit.
    if (row.serialItemId !== except?.serialItemId) used.set(row.key, { serialItemId: row.serialItemId, sku: row.sku })
  }
  return used
}

/** Advisory lock namespace (pg_advisory_xact_lock's first key) for serial numbers. */
const SERIAL_LOCK = 1

async function assertSerialsFree(tx: Prisma.TransactionClient, serialNumbers: readonly string[], except?: { serialItemId: number }) {
  // No index spans units and accessory serials, so the check below and the insert after it are made safe by a lock per
  // serial (upper case, in sorted order so two writers can't deadlock) held until the transaction ends: a concurrent
  // write of the same serial waits, then sees this one's rows.
  const keys = [...new Set(serialNumbers.map((serial) => serial.toUpperCase()))].toSorted()
  if (keys.length > 0) {
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(${SERIAL_LOCK}::int, hashtext(key))
      FROM unnest(${keys}::text[]) WITH ORDINALITY AS serial(key, n) ORDER BY n`
  }
  const used = await usedSerials(tx, serialNumbers, except)
  const seen = new Set<string>()
  const taken = serialNumbers.filter((serial) => {
    const key = serial.toUpperCase()
    const repeated = seen.has(key)
    seen.add(key)
    return repeated || used.has(key)
  })
  if (taken.length > 0) throw new SerialNumbersTakenError([...new Set(taken)])
}

async function assertActiveAccessories(tx: Prisma.TransactionClient, accessories: readonly { accessoryId: string }[]) {
  const ids = [...new Set(accessories.map((accessory) => accessory.accessoryId))]
  if (ids.length === 0) return
  const active = await tx.accessory.findMany({ where: { id: { in: ids }, isDeleted: false }, select: { id: true } })
  const missing = ids.filter((id) => !active.some((accessory) => accessory.id === id))
  if (missing.length > 0) throw new BadRequestError(`Accessories don't exist or are deleted: ${missing.join(", ")}`)
}
