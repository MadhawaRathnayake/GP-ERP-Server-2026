// `npm run import:old-serials -- <dir> [--dry-run | --apply]`
// One-off move of the old system's serial numbers, after import-old-invoices.ts (the units link to those invoices).
// <dir> holds `bsondump` output (one document per line) of the old collections products and invoices, and, optional,
// creditnotes (returns). docs/plans/serial-numbers.md §8.2:
//   no flag    converts everything (reading this database only), writes report-serials.csv and report-serial-stock.csv
//   --dry-run  also writes the units inside a transaction, then rolls it back
//   --apply    the same, and commits
// It adds rows to SerialItem, SerialItemMovement, SerialItemAccessory, InvoiceSerialItem (and one Accessory with its
// ProductAccessory rows), fills the old-invoice and old-serial links of quotations and invoices from their text, and
// stops if SerialItem already has rows. It never changes stock: report-serial-stock.csv lists the serial products whose
// stock in hand isn't their units in stock, for the owner to fix with Adjust stock.
// How a unit is worked out, from evidence:
// - The serial is cleaned: trimmed; "MAIN<tab>ACC", "MAIN,ACC" and "MAIN;" split, the second part (without
//   "WIFI STICK -") being an accessory serial. One unit per serial, ignoring case.
// - Its history is its invoices (not drafts) in date order: sold on each; a cancelled one gave it back; a credit note
//   after its last sale gave it back too. The last event decides: sold (on its last invoice, linked), or in stock.
// - Its product is the one of its last invoice line, or of the old stock list it is in (a unit in two lists: the
//   product with invoices). A unit sold only on a package line belongs to the package product (deleted here), so a
//   warranty lookup still finds it.
// - Sold on an invoice that wasn't imported, or in no stock list and on no invoice: removed, with the reason.
// - complimentary → the accessory "WiFi / data logger (old system)", batterySN → "Battery (old system)";
//   palletNumber kept. An accessory serial on two units stays on the one sold last.
// - The 4 open drafts get their scanned units picked again, when those are in stock.
import { readFileSync, existsSync, writeFileSync } from "node:fs"
import path from "node:path"
import type { Prisma, SerialItemStatus } from "#generated/prisma/client.js"
import { db } from "#core/db.js"

const args = process.argv.slice(2)
const dir = args.find((a) => !a.startsWith("--"))
const mode = args.includes("--apply") ? "apply" : args.includes("--dry-run") ? "dry-run" : "report"
if (!dir) {
  console.error("Usage: npm run import:old-serials -- <dir> [--dry-run | --apply]")
  process.exit(1)
}

const WIFI = "WiFi / data logger (old system)"
const BATTERY = "Battery (old system)"
const LISTS = ["serialNumbers", "serialNumbersInTransit", "serialNumbersSold"] as const

type OldDate = { $date: string | { $numberLong: string } }
type OldId = { $oid: string }
type OldSerial = { _id?: OldId | string; main?: string; complimentary?: string; batterySN?: string; palletNumber?: string }
type OldProduct = { sku?: string } & Partial<Record<(typeof LISTS)[number], OldSerial[]>>
type OldInvoice = {
  _id: OldId
  invoiceNumber: string
  isDraft: boolean
  cancelled: boolean
  date: OldDate
  cancelledAt?: OldDate
  updatedAt?: OldDate
  invoiceProducts: { sku: string; serialNumbers?: OldSerial[] }[]
}
type OldCreditNote = { cancelled?: boolean; date: OldDate; creditNoteNumber?: string; creditNoteProducts: { serialNumbers?: OldSerial[] }[] }

const lines = <T>(file: string) =>
  readFileSync(path.join(dir, file), "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as T)
const oldDate = (d: OldDate) => new Date(typeof d.$date === "string" ? d.$date : Number(d.$date.$numberLong))
// An ObjectId starts with its creation time. Some exported ids are plain strings, some missing.
const oidTime = (id: OldId | string | undefined) => {
  const hex = typeof id === "string" ? id : id?.$oid
  return hex && /^[0-9a-f]{24}$/i.test(hex) ? new Date(parseInt(hex.slice(0, 8), 16) * 1000) : null
}
const csv = (rows: Record<string, unknown>[]) =>
  rows.length === 0
    ? ""
    : [Object.keys(rows[0]!), ...rows.map((r) => Object.values(r))].map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n")

/** "MAIN<tab>WIFI STICK - ACC" → { main: "MAIN", accessory: "ACC" }. */
function clean(raw: string | undefined) {
  const parts = (raw ?? "")
    .trim()
    .split(/[\t,;]+/)
    .map((p) => p.trim())
    .filter(Boolean)
  return { main: parts[0] ?? "", accessory: parts[1]?.replace(/^WIFI STICK\s*-\s*/i, "").trim() || null }
}

// ─── Lookups ────────────────────────────────────────────────────────────────

const [products, invoices, existingAccessories] = await Promise.all([
  db.product.findMany({ select: { id: true, sku: true, title: true, stockInHand: true, trackingType: true, isDeleted: true, category: { select: { name: true } } } }),
  db.invoice.findMany({
    select: { id: true, invoiceNumber: true, draftNumber: true, status: true, finalizedAt: true, cancelledAt: true, createdBy: true, customerId: true },
  }),
  db.accessory.findMany({ select: { id: true, name: true } }),
])
const productBySku = new Map(products.map((p) => [p.sku.trim().toUpperCase(), p]))
const isPackage = (sku: string) => /package/i.test(productBySku.get(sku.trim().toUpperCase())?.category.name ?? "")
// Imported invoices by the old number (finalized ones by invoiceNumber, drafts by draftNumber).
const invoiceByOldNumber = new Map(invoices.map((i) => [i.invoiceNumber ?? i.draftNumber, i]))

// ─── Gather every appearance of every serial ─────────────────────────────────

type Sale = { at: Date; sku: string; invoiceNumber: string; cancelledAt: Date | null; isDraft: boolean }
type Unit = {
  key: string
  serial: string
  firstSeen: Date
  lists: { sku: string; list: (typeof LISTS)[number] }[]
  sales: Sale[]
  returns: { at: Date; number: string }[]
  wifi: Map<string, string>
  battery: Map<string, string>
  pallet: string | null
}
const units = new Map<string, Unit>()
const odd: string[] = []

function unitOf(entry: OldSerial, seen: Date) {
  const { main, accessory } = clean(entry.main)
  if (!main) return null
  if (/[^0-9A-Za-z-]/.test(main)) odd.push(main)
  const key = main.toUpperCase()
  let unit = units.get(key)
  if (!unit) {
    unit = { key, serial: main, firstSeen: seen, lists: [], sales: [], returns: [], wifi: new Map(), battery: new Map(), pallet: null }
    units.set(key, unit)
  }
  if (seen < unit.firstSeen) unit.firstSeen = seen
  for (const wifi of [accessory, clean(entry.complimentary).main]) if (wifi) unit.wifi.set(wifi.toUpperCase(), wifi)
  const battery = clean(entry.batterySN).main
  if (battery) unit.battery.set(battery.toUpperCase(), battery)
  if (entry.palletNumber?.trim()) unit.pallet = entry.palletNumber.trim()
  return unit
}

for (const product of lines<OldProduct>("products.json")) {
  const sku = product.sku?.trim() ?? ""
  for (const list of LISTS) {
    for (const entry of product[list] ?? []) unitOf(entry, oidTime(entry._id) ?? new Date())?.lists.push({ sku, list })
  }
}
for (const old of lines<OldInvoice>("invoices.json")) {
  const at = oldDate(old.date)
  const cancelledAt = old.cancelled ? (old.cancelledAt ? oldDate(old.cancelledAt) : old.updatedAt ? oldDate(old.updatedAt) : at) : null
  for (const line of old.invoiceProducts) {
    for (const entry of line.serialNumbers ?? []) {
      unitOf(entry, at)?.sales.push({ at, sku: line.sku.trim(), invoiceNumber: old.invoiceNumber.trim(), cancelledAt, isDraft: old.isDraft })
    }
  }
}
const creditNoteFile = "creditnotes.json"
const hasCreditNotes = existsSync(path.join(dir, creditNoteFile))
if (hasCreditNotes) {
  for (const note of lines<OldCreditNote>(creditNoteFile)) {
    if (note.cancelled) continue
    for (const line of note.creditNoteProducts) {
      for (const entry of line.serialNumbers ?? []) {
        const key = clean(entry.main).main.toUpperCase()
        units.get(key)?.returns.push({ at: oldDate(note.date), number: note.creditNoteNumber ?? "credit note" })
      }
    }
  }
}

// ─── Work out each unit ─────────────────────────────────────────────────────

type Event = { at: Date; from: SerialItemStatus | null; to: SerialItemStatus; invoiceId: number | null; remarks: string; createdBy: string | null }
type Pick = { invoiceId: number; productId: string; at: Date; releasedAt: Date | null; createdBy: string | null }
type Converted = {
  unit: Unit
  productId: string
  status: SerialItemStatus
  invoiceId: number | null
  events: Event[]
  picks: Pick[]
}
const converted: Converted[] = []
const report: Record<string, unknown>[] = []

for (const unit of units.values()) {
  const issues: string[] = []
  const finalSales = unit.sales.filter((sale) => !sale.isDraft).sort((a, b) => a.at.getTime() - b.at.getTime())
  const stockSkus = [...new Set(unit.lists.filter((l) => l.list === "serialNumbers").map((l) => l.sku))]
  const listSkus = [...new Set(unit.lists.map((l) => l.sku))]

  // The product: the last invoice line that isn't a package, else a stock list (the one with invoices when two), else
  // any list, else the package line.
  const lastLine = [...finalSales].reverse().find((sale) => !isPackage(sale.sku))
  const candidates = stockSkus.length > 0 ? stockSkus : listSkus.filter((sku) => !isPackage(sku))
  const listed = candidates.length > 1 ? (candidates.find((sku) => finalSales.some((sale) => sale.sku === sku)) ?? candidates[0]) : candidates[0]
  const sku = lastLine?.sku ?? listed ?? finalSales.at(-1)?.sku ?? listSkus[0]
  const product = sku ? productBySku.get(sku.toUpperCase()) : undefined
  if (!product) {
    report.push({ serial: unit.serial, imported: "no", product: sku ?? "", status: "", invoice: "", issues: `no product ${sku ?? "(none)"} here` })
    continue
  }
  if (candidates.length > 1) issues.push(`in the stock lists of ${candidates.join(", ")}; put on ${product.sku}`)

  // Its history, oldest first.
  const events: Event[] = [{ at: unit.firstSeen, from: null, to: "inStock", invoiceId: null, remarks: "Imported from the old system", createdBy: null }]
  const picks: Pick[] = []
  let status: SerialItemStatus = "inStock"
  let invoiceId: number | null = null
  const timeline = [
    ...finalSales.map((sale) => ({ at: sale.at, kind: "sale" as const, sale })),
    ...finalSales.filter((sale) => sale.cancelledAt).map((sale) => ({ at: sale.cancelledAt!, kind: "cancel" as const, sale })),
    ...unit.returns.map((ret) => ({ at: ret.at, kind: "return" as const, ret })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime())
  let notImported: string | null = null
  for (const step of timeline) {
    if (step.kind === "sale") {
      const invoice = invoiceByOldNumber.get(step.sale.invoiceNumber)
      if (!invoice) {
        notImported = step.sale.invoiceNumber
        continue
      }
      if (status === "sold" && invoiceId !== null) {
        // Sold again without a recorded return: the earlier pick ends here.
        const open = picks.findLast((pick) => pick.releasedAt === null)
        if (open) open.releasedAt = step.at
        events.push({ at: step.at, from: "sold", to: "inStock", invoiceId, remarks: "Old system: sold again without a return", createdBy: null })
      }
      status = "sold"
      invoiceId = invoice.id
      notImported = null
      picks.push({ invoiceId: invoice.id, productId: product.id, at: step.at, releasedAt: null, createdBy: invoice.createdBy })
      events.push({ at: step.at, from: "inStock", to: "sold", invoiceId: invoice.id, remarks: `Sold on ${step.sale.invoiceNumber}`, createdBy: invoice.createdBy })
    } else {
      const invoice = step.kind === "cancel" ? invoiceByOldNumber.get(step.sale.invoiceNumber) : null
      if (step.kind === "cancel" && (!invoice || invoice.id !== invoiceId)) continue
      if (status !== "sold") continue
      const open = picks.findLast((pick) => pick.releasedAt === null)
      if (open) open.releasedAt = step.at
      events.push({
        at: step.at,
        from: "sold",
        to: "inStock",
        invoiceId,
        remarks: step.kind === "cancel" ? `${step.sale.invoiceNumber} cancelled` : `Returned on ${step.ret.number}`,
        createdBy: null,
      })
      status = "inStock"
      invoiceId = null
    }
  }

  // Sold on an invoice that wasn't imported, or never in stock and never sold: removed, with the reason.
  const reason = notImported
    ? `Old system: sold on ${notImported}, which wasn't imported`
    : status === "inStock" && stockSkus.length === 0 && finalSales.length === 0
      ? "Old system: on no invoice and not in stock"
      : null
  if (reason && status === "inStock") {
    events.push({ at: events.at(-1)!.at, from: "inStock", to: "removed", invoiceId: null, remarks: reason, createdBy: null })
    status = "removed"
    issues.push(reason)
  }
  if (status === "inStock" && stockSkus.length === 0) issues.push("given back (cancelled or returned) but in no old stock list")
  if (status === "sold" && stockSkus.length > 0) issues.push("still in an old stock list after its sale (the list wasn't updated)")

  // The open drafts: their scanned units are picked again (in stock only, and on one draft at most).
  for (const sale of unit.sales.filter((s) => s.isDraft && !s.cancelledAt)) {
    const draft = invoiceByOldNumber.get(sale.invoiceNumber)
    if (draft?.status === "draft" && status === "inStock" && !picks.some((pick) => pick.releasedAt === null)) {
      picks.push({ invoiceId: draft.id, productId: product.id, at: sale.at, releasedAt: null, createdBy: draft.createdBy })
    }
  }

  converted.push({ unit, productId: product.id, status, invoiceId, events, picks })
  report.push({
    serial: unit.serial,
    imported: "yes",
    product: product.sku,
    status,
    invoice: invoiceId ? invoices.find((i) => i.id === invoiceId)?.invoiceNumber : "",
    issues: issues.join("; "),
  })
}

// Oldest first, so ids follow when each unit was first seen.
converted.sort((a, b) => a.unit.firstSeen.getTime() - b.unit.firstSeen.getTime() || a.unit.key.localeCompare(b.unit.key))

// Accessory serials are unique too: one on two units stays on the unit sold last.
const accessoryOwner = new Map<string, Converted>()
const lastActivity = (c: Converted) => c.events.at(-1)!.at.getTime()
let accessoryClashes = 0
for (const c of converted) {
  for (const key of [...c.unit.wifi.keys(), ...c.unit.battery.keys()]) {
    const owner = accessoryOwner.get(key)
    if (!owner) accessoryOwner.set(key, c)
    else {
      accessoryClashes++
      if (lastActivity(c) > lastActivity(owner)) accessoryOwner.set(key, c)
    }
  }
}

// Products that get units but are counted by quantity here (e.g. a duplicate SKU the old invoices sold the units under).
const switchedToSerial = products.filter((p) => p.trackingType === "quantity" && converted.some((c) => c.productId === p.id))

// ─── Stock report: units in stock against stock in hand ──────────────────────

const unitsInStock = new Map<string, number>()
for (const c of converted) if (c.status === "inStock") unitsInStock.set(c.productId, (unitsInStock.get(c.productId) ?? 0) + 1)
const stockReport = products
  .filter((p) => (p.trackingType === "serial" || switchedToSerial.includes(p)) && !p.isDeleted)
  .map((p) => ({ sku: p.sku, title: p.title, stockInHand: p.stockInHand, unitsInStock: unitsInStock.get(p.id) ?? 0 }))
  .filter((row) => row.stockInHand !== row.unitsInStock)
  .map((row) => ({
    ...row,
    difference: row.stockInHand - row.unitsInStock,
    suggestion:
      row.unitsInStock === 0 && row.stockInHand > 0
        ? "no serials recorded: register them (Adjust stock → Register) or switch the product to quantity tracking"
        : row.stockInHand > row.unitsInStock
          ? "count the shelf; register the units without serials, or adjust stock down"
          : "count the shelf; more units than stock: adjust stock up, or remove units",
  }))

writeFileSync(path.join(dir, "report-serials.csv"), csv(report))
writeFileSync(path.join(dir, "report-serial-stock.csv"), csv(stockReport))
const tally = <T>(rows: T[], pick: (r: T) => unknown) =>
  Object.fromEntries([...rows.reduce((m, r) => m.set(String(pick(r)), (m.get(String(pick(r))) ?? 0) + 1), new Map<string, number>())])
const imported = converted.length
console.log(`Units: ${imported} of ${units.size} serials, credit notes ${hasCreditNotes ? "read" : `not found (${creditNoteFile})`}`)
console.log("  status:", tally(converted, (c) => c.status))
console.log("  on a deleted product (packages, dropped duplicates):", converted.filter((c) => products.find((p) => p.id === c.productId)?.isDeleted).length)
console.log("  movements:", converted.reduce((n, c) => n + c.events.length, 0), " invoice picks:", converted.reduce((n, c) => n + c.picks.length, 0))
console.log("  accessories: WiFi", converted.reduce((n, c) => n + c.unit.wifi.size, 0), " battery", converted.reduce((n, c) => n + c.unit.battery.size, 0), " on two units", accessoryClashes)
console.log("  serials still odd after cleaning:", [...new Set(odd)].slice(0, 5))
console.log("  not imported:", report.filter((r) => r.imported === "no").length, " with issues:", report.filter((r) => r.imported === "yes" && r.issues).length)
console.log("Products switched to serial tracking (they get units):", switchedToSerial.map((p) => p.sku))
console.log(`Serial products whose stock in hand isn't their units in stock: ${stockReport.length} (report-serial-stock.csv; stock isn't changed)`)
console.log(`Reports: ${path.join(dir, "report-serials.csv")}, ${path.join(dir, "report-serial-stock.csv")}`)

// ─── Write ──────────────────────────────────────────────────────────────────

class RolledBack extends Error {}

// Rows are written 500 at a time, one insert after another, with progress. One createMany of everything makes Prisma split
// it into parameter-limited queries sent in parallel over the transaction's single connection (pg's "already executing
// a query" warning), and the first --apply stalled there.
const CHUNK = 500
async function insertInChunks<T>(label: string, rows: T[], insert: (data: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += CHUNK) {
    await insert(rows.slice(i, i + CHUNK))
    process.stdout.write(`\r  ${label}: ${Math.min(i + CHUNK, rows.length)} of ${rows.length}`)
  }
  if (rows.length) process.stdout.write("\n")
}

if (mode !== "report") {
  try {
    await db.$transaction(
      async (tx) => {
        if ((await tx.serialItem.count()) > 0) throw new Error("SerialItem already has rows; this script only fills an empty table.")
        const accessoryId = async (name: string) =>
          existingAccessories.find((a) => a.name === name)?.id ?? (await tx.accessory.create({ data: { name, description: "Imported from the old system" } })).id
        const wifiId = await accessoryId(WIFI)
        const batteryId = converted.some((c) => c.unit.battery.size > 0) ? await accessoryId(BATTERY) : null

        const items: Prisma.SerialItemCreateManyInput[] = []
        const movements: Prisma.SerialItemMovementCreateManyInput[] = []
        const accessories: Prisma.SerialItemAccessoryCreateManyInput[] = []
        const picks: Prisma.InvoiceSerialItemCreateManyInput[] = []
        const productAccessories = new Map<string, { accessoryId: string; productId: string }>()
        for (const [index, c] of converted.entries()) {
          const id = index + 1
          items.push({
            id,
            productId: c.productId,
            serialNumber: c.unit.serial,
            palletNumber: c.unit.pallet,
            status: c.status,
            invoiceId: c.invoiceId,
            createdAt: c.unit.firstSeen,
            modifiedAt: c.events.length > 1 ? c.events.at(-1)!.at : null,
          })
          for (const event of c.events) {
            movements.push({ serialItemId: id, fromStatus: event.from, toStatus: event.to, invoiceId: event.invoiceId, remarks: event.remarks, createdBy: event.createdBy, createdAt: event.at })
          }
          for (const [key, serialNumber] of c.unit.wifi) {
            if (accessoryOwner.get(key) !== c) continue
            accessories.push({ serialItemId: id, accessoryId: wifiId, serialNumber, createdAt: c.unit.firstSeen })
            productAccessories.set(`${c.productId}|${wifiId}`, { productId: c.productId, accessoryId: wifiId })
          }
          for (const [key, serialNumber] of c.unit.battery) {
            if (accessoryOwner.get(key) !== c || !batteryId) continue
            accessories.push({ serialItemId: id, accessoryId: batteryId, serialNumber, createdAt: c.unit.firstSeen })
            productAccessories.set(`${c.productId}|${batteryId}`, { productId: c.productId, accessoryId: batteryId })
          }
          for (const pick of c.picks) {
            picks.push({ invoiceId: pick.invoiceId, productId: pick.productId, serialItemId: id, releasedAt: pick.releasedAt, createdBy: pick.createdBy, createdAt: pick.at })
          }
        }
        movements.sort((a, b) => (a.createdAt as Date).getTime() - (b.createdAt as Date).getTime())
        picks.sort((a, b) => (a.createdAt as Date).getTime() - (b.createdAt as Date).getTime())

        // A product that gets units is tracked by serial number (the tracking type can't change once it has units).
        await tx.product.updateMany({ where: { id: { in: switchedToSerial.map((p) => p.id) } }, data: { trackingType: "serial", modifiedAt: new Date() } })
        await insertInChunks("SerialItem", items, (data) => tx.serialItem.createMany({ data }))
        await insertInChunks("SerialItemMovement", movements, (data) => tx.serialItemMovement.createMany({ data }))
        await insertInChunks("SerialItemAccessory", accessories, (data) => tx.serialItemAccessory.createMany({ data }))
        await insertInChunks("InvoiceSerialItem", picks, (data) => tx.invoiceSerialItem.createMany({ data }))
        const existing = await tx.productAccessory.findMany({ where: { isDeleted: false }, select: { productId: true, accessoryId: true } })
        await tx.productAccessory.createMany({
          data: [...productAccessories.values()]
            .filter((pa) => !existing.some((e) => e.productId === pa.productId && e.accessoryId === pa.accessoryId))
            .map((pa) => ({ ...pa, quantity: 1 })),
        })
        await tx.$executeRawUnsafe(`SELECT setval(pg_get_serial_sequence('"SerialItem"', 'id'), ${Math.max(items.length, 1)}, ${items.length > 0})`)

        // The old-serial and old-invoice links of quotations and invoices, from their text: numbers that match a unit or
        // an imported invoice are linked; the rest stay text.
        const linked = {
          quotationSerials: await tx.$executeRaw`
            UPDATE "Quotation" q SET "oldSerialItemId" = s.id FROM "SerialItem" s
            WHERE q."oldSerialItemId" IS NULL AND q."oldSerialNumber" IS NOT NULL AND upper(s."serialNumber") = upper(btrim(q."oldSerialNumber"))`,
          quotationInvoices: await tx.$executeRaw`
            UPDATE "Quotation" q SET "oldInvoiceId" = i.id FROM "Invoice" i
            WHERE q."oldInvoiceId" IS NULL AND q."oldInvoiceNumber" IS NOT NULL AND i."invoiceNumber" = btrim(q."oldInvoiceNumber")`,
          invoiceSerials: await tx.$executeRaw`
            UPDATE "Invoice" v SET "oldSerialItemId" = s.id FROM "SerialItem" s
            WHERE v."oldSerialItemId" IS NULL AND v."oldSerialNumber" IS NOT NULL AND upper(s."serialNumber") = upper(btrim(v."oldSerialNumber"))`,
        }
        console.log(`Wrote ${items.length} units, ${movements.length} movements, ${accessories.length} accessory serials, ${picks.length} invoice picks.`)
        console.log("Links filled from text:", linked)
        if (mode === "dry-run") throw new RolledBack()
      },
      { maxWait: 60_000, timeout: 30 * 60_000 },
    )
    console.log("Committed.")
  } catch (err) {
    if (!(err instanceof RolledBack)) throw err
    console.log("Dry run: everything was written and then rolled back. Run with --apply to keep it.")
  }
}
await db.$disconnect()
