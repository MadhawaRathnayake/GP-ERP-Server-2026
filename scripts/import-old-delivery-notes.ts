// `npm run import:old-delivery-notes -- <dir> [--dry-run | --apply]`
// One-off move of the old system's delivery notes, after `import:old-invoices` (a note belongs to its invoice).
// <dir> holds `bsondump` output (one document per line) of the old collection deliverynotes, and optionally dncounters.
//   no flag    converts everything (reading this database only), writes report-delivery-notes.csv to <dir>
//   --dry-run  also writes the notes inside a transaction, then rolls it back
//   --apply    the same, and commits
// It only adds rows to DeliveryNote (and moves the GPDN- number counter on), and stops if DeliveryNote already has rows,
// so run it before any invoice is finalized here.
// - Numbers are kept (GPDN-123); ids follow them. New notes are numbered after the last old one.
// - Delivered → issued (when it was delivered, else when it was made); Pending → draft, to be issued here; Cancelled →
//   cancelled. A note of an invoice that was cancelled after it was finalized is cancelled, whatever the old status.
// - Notes are marked isImported. The old verifier and issuer were typed names, kept as oldItemVerifierName /
//   oldItemIssuerName (spellings of one person made the same: "Kavindu" → "Kavindu Karunanayaka", "Palanyandy
//   Vidurshan" → "Vidurshan Palanyandy"), and linked to the user with that name where there is one. An imported issued
//   note may lack them (DeliveryNote_issued_check allows it).
// - Left out, in the report: notes whose invoice wasn't imported, and notes of service invoices (they have none here).
//   The old dispatch date and delivery method (a handful of notes) have no column here yet.
// - A finalized imported sales or warranty invoice with no old note gets a new draft, as finalizing does here.
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import type { DeliveryNoteStatus, Prisma } from "#generated/prisma/client.js"
import { db } from "#core/db.js"

const args = process.argv.slice(2)
const dir = args.find((a) => !a.startsWith("--"))
const mode = args.includes("--apply") ? "apply" : args.includes("--dry-run") ? "dry-run" : "report"
if (!dir) {
  console.error("Usage: npm run import:old-delivery-notes -- <dir> [--dry-run | --apply]")
  process.exit(1)
}

type OldNumber = { $numberInt: string } | { $numberDouble: string } | { $numberLong: string }
type OldDate = { $date: string | { $numberLong: string } }
type OldId = { $oid: string }
type OldNote = {
  _id: OldId
  deliveryNoteNumber: string
  invoiceNumber: string
  customerCode: string
  date: OldDate
  status: "Delivered" | "Pending" | "Cancelled"
  itemVerifierName?: string
  itemIssuerName?: string
  deliveredTime?: OldDate
  dispatchDate?: OldDate
  deliveryMethod?: string
}

const lines = <T>(file: string) =>
  readFileSync(path.join(dir, file), "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as T)
const oldDate = (d: OldDate) => new Date(typeof d.$date === "string" ? d.$date : Number(d.$date.$numberLong))
const oidTime = (id: OldId) => new Date(parseInt(id.$oid.slice(0, 8), 16) * 1000)
const numberOf = (deliveryNoteNumber: string) => Number(deliveryNoteNumber.replace(/^GPDN-/, ""))
const csv = (rows: Record<string, unknown>[]) =>
  rows.length === 0
    ? ""
    : [Object.keys(rows[0]!), ...rows.map((r) => Object.values(r))].map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n")

// ─── Lookups ────────────────────────────────────────────────────────────────

const oldNotes = lines<OldNote>("deliverynotes.json").sort((a, b) => numberOf(a.deliveryNoteNumber) - numberOf(b.deliveryNoteNumber))
const oldCounter = existsSync(path.join(dir, "dncounters.json"))
  ? Math.max(0, ...lines<{ seq: OldNumber }>("dncounters.json").map((c) => Number(Object.values(c.seq)[0])))
  : 0
const [invoices, users] = await Promise.all([
  db.invoice.findMany({
    where: { isImported: true },
    select: {
      id: true,
      invoiceNumber: true,
      status: true,
      type: true,
      finalizedAt: true,
      finalizedBy: true,
      cancelledAt: true,
      cancelledBy: true,
      createdBy: true,
    },
  }),
  db.user.findMany({ where: { isDeleted: false }, select: { id: true, name: true } }),
])
const invoiceByNumber = new Map(invoices.map((i) => [i.invoiceNumber, i]))
const userByName = new Map(users.map((u) => [u.name.trim().toLowerCase(), u]))

// One spelling per person: names with the same words are one name (the commonest spelling wins), and a first name alone
// is the one full name that has it, when there's exactly one.
const words = (name: string) => name.toLowerCase().split(/\s+/).sort().join(" ")
const spellings = new Map<string, Map<string, number>>()
const typed = (name: string | undefined) => name?.trim().replace(/\s+/g, " ") || null
for (const note of oldNotes) {
  for (const name of [typed(note.itemVerifierName), typed(note.itemIssuerName)]) {
    if (!name || !name.includes(" ")) continue
    const counts = spellings.get(words(name)) ?? new Map<string, number>()
    spellings.set(words(name), counts.set(name, (counts.get(name) ?? 0) + 1))
  }
}
const fullNames = [...spellings.values()].map((counts) => [...counts].sort((a, b) => b[1] - a[1])[0]![0])
const personOf = (raw: string | undefined) => {
  const name = typed(raw)
  if (!name) return null
  if (name.includes(" ")) return fullNames.find((full) => words(full) === words(name)) ?? name
  const matches = fullNames.filter((full) => full.toLowerCase().split(" ").includes(name.toLowerCase()))
  return matches.length === 1 ? matches[0]! : name
}

// ─── Convert ────────────────────────────────────────────────────────────────

const report: Record<string, unknown>[] = []
const notes: Prisma.DeliveryNoteCreateManyInput[] = []
const linkedNames = new Map<string, string>()
const unlinkedNames = new Map<string, number>()
const noted = new Set<number>()

for (const old of oldNotes) {
  const issues: string[] = []
  const invoice = invoiceByNumber.get(old.invoiceNumber)
  const verifierName = personOf(old.itemVerifierName)
  const issuerName = personOf(old.itemIssuerName)
  const row = (status: DeliveryNoteStatus | null) =>
    report.push({
      deliveryNoteNumber: old.deliveryNoteNumber,
      invoiceNumber: old.invoiceNumber,
      oldStatus: old.status,
      status: status ?? "",
      imported: status ? "yes" : "no",
      itemVerifier: verifierName ?? "",
      itemIssuer: issuerName ?? "",
      issues: issues.join("; "),
    })

  if (!invoice) {
    issues.push("its invoice wasn't imported")
    row(null)
    continue
  }
  if (invoice.type === "service") {
    issues.push("service invoice: no delivery note here")
    row(null)
    continue
  }
  if (invoice.status !== "finalized" && invoice.status !== "cancelledAfterFinalized") {
    issues.push(`invoice is ${invoice.status}`)
    row(null)
    continue
  }
  if (noted.has(invoice.id)) {
    issues.push("the invoice already has a note")
    row(null)
    continue
  }

  const status: DeliveryNoteStatus =
    invoice.status === "cancelledAfterFinalized" ? "cancelled" : old.status === "Delivered" ? "issued" : old.status === "Pending" ? "draft" : "cancelled"
  if (invoice.status === "cancelledAfterFinalized" && old.status !== "Cancelled") issues.push(`was ${old.status}, its invoice is cancelled`)
  if (invoice.status === "finalized" && old.status === "Cancelled") issues.push("cancelled, but its invoice isn't")
  if (old.dispatchDate || old.deliveryMethod) issues.push("dispatch date / delivery method not kept")

  const link = (name: string | null) => {
    if (!name) return null
    const user = userByName.get(name.toLowerCase())
    if (user) linkedNames.set(name, user.id)
    else unlinkedNames.set(name, (unlinkedNames.get(name) ?? 0) + 1)
    return user?.id ?? null
  }
  const itemVerifierId = link(verifierName)
  // A draft has no issuer yet, and the two are different users.
  let itemIssuerId = status === "draft" ? null : link(issuerName)
  if (itemIssuerId !== null && itemIssuerId === itemVerifierId) {
    issues.push("verifier and issuer are the same user: issuer left as a name only")
    itemIssuerId = null
  }

  const createdAt = oidTime(old._id)
  const deliveredAt = old.deliveredTime ? oldDate(old.deliveredTime) : null
  noted.add(invoice.id)
  notes.push({
    id: notes.length + 1,
    deliveryNoteNumber: old.deliveryNoteNumber,
    invoiceId: invoice.id,
    status,
    itemVerifierId,
    itemIssuerId,
    issuedAt: status === "issued" ? (deliveredAt ?? createdAt) : null,
    isImported: true,
    oldItemVerifierName: verifierName,
    oldItemIssuerName: issuerName,
    createdBy: invoice.finalizedBy ?? invoice.createdBy,
    createdAt,
    modifiedBy: status === "cancelled" ? invoice.cancelledBy : null,
    modifiedAt: status === "cancelled" ? invoice.cancelledAt : deliveredAt,
  })
  row(status)
}

// Finalized imported invoices the old system made no note for get one now (numbered after the old ones).
const newDrafts = invoices
  .filter((i) => i.type !== "service" && !noted.has(i.id) && (i.status === "finalized" || i.status === "cancelledAfterFinalized"))
  .sort((a, b) => a.id - b.id)
for (const invoice of newDrafts) {
  report.push({
    deliveryNoteNumber: "(new)",
    invoiceNumber: invoice.invoiceNumber,
    oldStatus: "",
    status: invoice.status === "finalized" ? "draft" : "cancelled",
    imported: "new",
    itemVerifier: "",
    itemIssuer: "",
    issues: "the old system has no note for this invoice: a new one is made",
  })
}
const lastNumber = Math.max(oldCounter, ...notes.map((n) => numberOf(n.deliveryNoteNumber!)))

writeFileSync(path.join(dir, "report-delivery-notes.csv"), csv(report))
const tally = <T>(rows: T[], pick: (r: T) => unknown) =>
  Object.fromEntries([...rows.reduce((m, r) => m.set(String(pick(r)), (m.get(String(pick(r))) ?? 0) + 1), new Map<string, number>())])
console.log(`Delivery notes: ${notes.length} of ${oldNotes.length}`)
console.log("  old → new status:", tally(report.filter((r) => r.imported === "yes"), (r) => `${r.oldStatus} → ${r.status}`))
console.log("  not imported:", report.filter((r) => r.imported === "no").map((r) => `${r.deliveryNoteNumber} (${r.invoiceNumber}): ${r.issues}`))
console.log("  with issues:", report.filter((r) => r.imported === "yes" && r.issues).length)
console.log("  new drafts for invoices with no old note:", newDrafts.map((i) => i.invoiceNumber))
console.log("  names linked to users:", Object.fromEntries(linkedNames))
console.log("  names with no user (kept as text):", Object.fromEntries(unlinkedNames))
console.log(`  new notes are numbered from GPDN-${lastNumber + 1}`)
console.log(`Report: ${path.join(dir, "report-delivery-notes.csv")}`)

// ─── Write ──────────────────────────────────────────────────────────────────

class RolledBack extends Error {}

// Rows are written 500 at a time, one insert after another, with progress (see import-old-invoices.ts).
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
        if ((await tx.deliveryNote.count()) > 0) throw new Error("DeliveryNote already has rows; this script only fills an empty table.")
        await insertInChunks("DeliveryNote", notes, (data) => tx.deliveryNote.createMany({ data }))
        await tx.$executeRawUnsafe(`SELECT setval('delivery_note_number_seq', ${Math.max(lastNumber, 1)}, ${lastNumber > 0})`)
        await tx.$executeRawUnsafe(`SELECT setval(pg_get_serial_sequence('"DeliveryNote"', 'id'), ${Math.max(notes.length, 1)}, ${notes.length > 0})`)
        // Numbered by the database (next_delivery_note_number), after the old ones.
        for (const invoice of newDrafts) {
          await tx.deliveryNote.create({
            data: {
              invoiceId: invoice.id,
              status: invoice.status === "finalized" ? "draft" : "cancelled",
              createdBy: invoice.finalizedBy ?? invoice.createdBy,
              createdAt: invoice.finalizedAt ?? undefined,
            },
          })
        }
        console.log(`Wrote ${notes.length + newDrafts.length} delivery notes.`)
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
