// `npm run import:old-data -- <dir> [--dry-run | --apply]`
// One-off move of products, customers and suppliers from the old system (MongoDB + Contentful) into this database.
// <dir> holds `bsondump` output (one document per line) of the old collections products, customers, suppliers,
// invoices, internalrequisitions, purchaseorders and grns, plus contentful-products.json and contentful-assets.json
// (arrays from the Contentful Management API, so archived entries are included).
//   no flag    reads and converts everything, writes report-*.csv to <dir>; the database isn't touched
//   --dry-run  also writes everything to the database inside a transaction, then rolls it back
//   --apply    the same, and commits
// Writing empties the product, customer and supplier tables and every table that refers to them (quotations,
// invoices, delivery notes, procurement, approvals, movements, document counters) and restarts their ids and
// numbers at 1. Users, roles, permissions, settings, dropdowns, approval rules and categories are kept.
import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { db } from "#core/db.js"

const args = process.argv.slice(2)
const dir = args.find((a) => !a.startsWith("--"))
const mode = args.includes("--apply") ? "apply" : args.includes("--dry-run") ? "dry-run" : "report"
if (!dir) {
  console.error("Usage: npm run import:old-data -- <dir> [--dry-run | --apply]")
  process.exit(1)
}

// ─── Old data shapes (only the fields used) ─────────────────────────────────

type OldNumber = { $numberInt: string } | { $numberDouble: string } | { $numberLong: string }
type OldDate = { $date: string | { $numberLong: string } }
type OldId = { $oid: string }
type OldSerial = { main?: string }
type OldProduct = {
  _id: OldId
  sku?: string
  price?: OldNumber | null
  cost?: OldNumber | null
  stock?: OldNumber
  stockInTransit?: OldNumber
  deleted?: boolean
  serialNumbers?: OldSerial[]
  serialNumbersInTransit?: OldSerial[]
  serialNumbersSold?: OldSerial[]
}
type OldCustomer = {
  _id: OldId
  code: string
  title?: string
  name: string
  address: string
  houseNumber?: string
  street?: string
  city?: string
  district?: string
  province?: string
  country?: string
  telephone: string
  contactPerson?: string
  contactPersonMobile?: string
  email?: string
  vatNumber?: string
  tinNumber?: string
  companyPV_number?: string
  seaRegistrationNumber?: string
  notes?: string
  customerClassification?: "B2B" | "B2C"
  isCommissioned?: boolean
  status?: "active" | "inactive"
  archived?: boolean
  createdAt?: OldDate
}
type OldSupplier = { _id: OldId; code: string; name: string; address: string; telephone: string; email?: string; vatNumber?: string }
type OldInvoice = { invoiceProducts?: { sku?: string; newWarranty?: string | null }[] }
type OldOrderLine = { itemCode?: string; description?: string }
type OldOrder = { products?: OldOrderLine[]; poProducts?: OldOrderLine[] }
type Localized<T> = { "en-US"?: T }
type Link = { sys: { id: string } }
type RichText = { value?: string; content?: RichText[] }
type ContentfulEntry = {
  sys: { archivedVersion?: number; updatedAt: string }
  fields: {
    sku?: Localized<string>
    productName?: Localized<string>
    productDescription?: Localized<string>
    category?: Localized<string>
    productImages?: Localized<Link[]>
    pdfDocument?: Localized<Link>
    manufacturer?: Localized<string>
    countryOfOrigin?: Localized<string>
    minStock?: Localized<number>
    warranty?: Localized<string>
    additionalInfo?: Localized<RichText>
    deleted?: Localized<boolean>
  }
}
type ContentfulAsset = { sys: { id: string }; fields: { file?: Localized<{ url: string }> } }

// ─── Helpers ────────────────────────────────────────────────────────────────

const lines = <T>(file: string) =>
  readFileSync(path.join(dir, file), "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as T)
const json = <T>(file: string) => JSON.parse(readFileSync(path.join(dir, file), "utf8")) as T
const num = (v: OldNumber | null | undefined) => (v ? Number(Object.values(v)[0]) : null)
const oidTime = (id: OldId) => new Date(parseInt(id.$oid.slice(0, 8), 16) * 1000)
const oldDate = (d: OldDate) => new Date(typeof d.$date === "string" ? d.$date : Number(d.$date.$numberLong))
const text = (v: string | null | undefined) => v?.trim() || null
const known = (v: string | null | undefined) => (text(v) && !/^n\/?a$/i.test(v!.trim()) ? v!.trim() : null)
const id = (prefix: string, n: number, width: number) => prefix + String(n).padStart(width, "0")
const money = (v: number | null) => (v !== null && Number.isFinite(v) && v > 0 ? (Math.round((v + Number.EPSILON) * 100) / 100).toFixed(2) : "0.00")
const skuKey = (sku: string) => sku.trim().toUpperCase()
const byOld = <T extends { _id: OldId }>(a: T, b: T) => a._id.$oid.localeCompare(b._id.$oid)
const csv = (rows: Record<string, unknown>[]) =>
  rows.length === 0
    ? ""
    : [Object.keys(rows[0]!), ...rows.map((r) => Object.values(r))].map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n")

/** "10 years", "11 yrs", "2 Years Warranty / …", "18 months" → months; null when there's no number with a unit. */
function warrantyMonths(value: string | null | undefined) {
  const m = value?.match(/(\d+(?:\.\d+)?)\s*(years?|yrs?|y|months?|m)\b/i)
  if (!m) return null
  return Math.round(Number(m[1]) * (/^m/i.test(m[2]!) ? 1 : 12))
}

/** Splits "0777 538931 / +94 (11) 241 3841, N/A" into ["0777538931", "+94112413841"]; returns what it dropped too. */
function phoneList(raw: string | null | undefined) {
  const kept: string[] = []
  const dropped: string[] = []
  const norm = (part: string) => (part.trim().startsWith("+") ? "+" : "") + part.replace(/\D/g, "")
  for (const part of (known(raw) ?? "").split(/[/,;&]/)) {
    if (!part.trim()) continue
    let numbers = [norm(part)]
    // Two numbers with only spaces between them.
    if (numbers[0]!.replace("+", "").length > 15) numbers = part.trim().split(/\s+/).map(norm)
    for (const n of numbers) {
      if (/^\+?\d{7,15}$/.test(n)) {
        if (!kept.includes(n)) kept.push(n)
      } else dropped.push(part.trim())
    }
  }
  return { kept, dropped: [...new Set(dropped)] }
}

const plain = (node: RichText | undefined): string =>
  node ? (node.value ?? "") + (node.content ?? []).map(plain).join(node.content?.some((c) => c.content) ? "\n" : "") : ""

// ─── Products ───────────────────────────────────────────────────────────────

const oldProducts = lines<OldProduct>("products.json")
const entries = json<ContentfulEntry[]>("contentful-products.json")
const assets = new Map(json<ContentfulAsset[]>("contentful-assets.json").map((a) => [a.sys.id, a.fields.file?.["en-US"]?.url]))
const assetUrl = (link: Link | undefined) => {
  const url = link && assets.get(link.sys.id)
  return url ? (url.startsWith("//") ? `https:${url}` : url) : null
}

// One Contentful entry per SKU: a live one before an archived one, then the latest edit.
const contentful = new Map<string, ContentfulEntry>()
for (const e of [...entries].sort((a, b) => Number(!!b.sys.archivedVersion) - Number(!!a.sys.archivedVersion) || a.sys.updatedAt.localeCompare(b.sys.updatedAt))) {
  const sku = e.fields.sku?.["en-US"]
  if (sku) contentful.set(skuKey(sku), e)
}

// Category by SKU prefix (5, 4, then 3 characters), learnt from the SKUs Contentful has, for SKUs it doesn't have.
const prefixCategories = new Map<string, Map<string, number>>()
for (const [sku, e] of contentful) {
  const category = text(e.fields.category?.["en-US"])
  if (!category || sku.startsWith("TEST")) continue
  for (const len of [5, 4, 3]) {
    const counts = prefixCategories.get(sku.slice(0, len)) ?? new Map<string, number>()
    counts.set(category, (counts.get(category) ?? 0) + 1)
    prefixCategories.set(sku.slice(0, len), counts)
  }
}
const guessCategory = (sku: string) => {
  for (const len of [5, 4, 3]) {
    const counts = prefixCategories.get(sku.slice(0, len))
    if (counts) return [...counts].sort((a, b) => b[1] - a[1])[0]![0]
  }
  return "Other"
}

// Names for SKUs Contentful doesn't have: the description on the latest IR, PO or GRN line.
const orderNames = new Map<string, string>()
for (const file of ["internalrequisitions.json", "purchaseorders.json", "grns.json"]) {
  for (const order of lines<OldOrder>(file)) {
    for (const line of [...(order.products ?? []), ...(order.poProducts ?? [])]) {
      if (line.itemCode && text(line.description)) orderNames.set(skuKey(line.itemCode), line.description!.trim())
    }
  }
}

// Warranty for SKUs whose Contentful entry has none: the most common warranty on their old invoice lines.
const invoiceWarranties = new Map<string, Map<number, number>>()
for (const invoice of lines<OldInvoice>("invoices.json")) {
  for (const line of invoice.invoiceProducts ?? []) {
    const months = warrantyMonths(line.newWarranty)
    if (!line.sku || months === null) continue
    const counts = invoiceWarranties.get(skuKey(line.sku)) ?? new Map<number, number>()
    counts.set(months, (counts.get(months) ?? 0) + 1)
    invoiceWarranties.set(skuKey(line.sku), counts)
  }
}

// The old system worked on the first (oldest) document of a SKU (Product.findOne({ sku })); a bulk import in 2024
// made empty copies of many. Keep the oldest, drop the copies.
const groups = new Map<string, OldProduct[]>()
for (const p of oldProducts.filter((p) => p.sku?.trim()).sort(byOld)) {
  const list = groups.get(skuKey(p.sku!)) ?? []
  list.push(p)
  groups.set(skuKey(p.sku!), list)
}

const productReport: Record<string, unknown>[] = []
const products = [...groups.values()].map((docs) => {
  const p = docs[0]!
  const key = skuKey(p.sku!)
  const entry = contentful.get(key)
  const f = entry?.fields
  const issues: string[] = []

  const cfName = text(f?.productName?.["en-US"])
  const title = (cfName ?? orderNames.get(key) ?? p.sku!.trim()).slice(0, 200)
  const titleFrom = cfName ? "Contentful" : orderNames.has(key) ? "IR/PO/GRN description" : "SKU (no name anywhere)"
  const cfCategory = text(f?.category?.["en-US"])
  const category = cfCategory ?? guessCategory(key)

  const cfWarranty = warrantyMonths(f?.warranty?.["en-US"])
  const invoiceWarranty = [...(invoiceWarranties.get(key) ?? [])].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
  const warranty = cfWarranty ?? invoiceWarranty ?? 0

  const rawStock = num(p.stock) ?? 0
  const rawTransit = num(p.stockInTransit) ?? 0
  const stockInHand = Math.max(0, Math.floor(rawStock))
  const stockInTransit = Math.max(0, Math.floor(rawTransit))
  if (!Number.isInteger(rawStock) || !Number.isInteger(rawTransit)) issues.push(`fractional stock ${rawStock} / in transit ${rawTransit}, rounded down`)
  if (rawStock < 0) issues.push(`stock in hand was ${rawStock}, set to 0`)
  if (rawTransit < 0) issues.push(`in transit was ${rawTransit}, set to 0`)
  if (p.price == null) issues.push("no price, set to 0")
  const droppedWithStock = docs.slice(1).filter((d) => num(d.stock) || num(d.stockInTransit))
  if (droppedWithStock.length) issues.push(`dropped ${droppedWithStock.length} duplicate(s) that also had stock: ${droppedWithStock.map((d) => num(d.stock)).join(", ")}`)

  const hasSerials = docs.some((d) => (d.serialNumbers?.length ?? 0) + (d.serialNumbersInTransit?.length ?? 0) + (d.serialNumbersSold?.length ?? 0) > 0)
  const isDeleted = p.deleted === true || f?.deleted?.["en-US"] === true
  const additionalInfo = plain(f?.additionalInfo?.["en-US"]).trim().slice(0, 5000) || null

  return {
    row: {
      sku: p.sku!.trim(),
      title,
      description: (text(f?.productDescription?.["en-US"]) ?? "N/A").slice(0, 5000),
      category,
      manufacturer: known(f?.manufacturer?.["en-US"])?.slice(0, 200) ?? null,
      countryOfOrigin: known(f?.countryOfOrigin?.["en-US"])?.slice(0, 100) ?? null,
      imageUrl: assetUrl(f?.productImages?.["en-US"]?.[0]),
      documentUrl: assetUrl(f?.pdfDocument?.["en-US"]),
      warrantyMonths: warranty,
      price: money(num(p.price)),
      cost: money(num(p.cost)),
      minimumStock: Math.max(0, Math.floor(f?.minStock?.["en-US"] ?? 0)),
      stockInHand,
      stockInTransit,
      additionalInfo,
      trackingType: hasSerials ? ("serial" as const) : ("quantity" as const),
      createdAt: oidTime(p._id),
      isDeleted,
    },
    report: {
      sku: p.sku!.trim(),
      title,
      titleFrom,
      category,
      categoryFrom: cfCategory ? "Contentful" : "guessed from SKU prefix",
      warrantyMonths: warranty,
      warrantyFrom: cfWarranty !== null ? "Contentful" : invoiceWarranty !== null ? "old invoices" : "none (0)",
      duplicatesDropped: docs.length - 1,
      isDeleted,
      issues: issues.join("; "),
    },
  }
})
products.sort((a, b) => a.row.createdAt.getTime() - b.row.createdAt.getTime())
products.forEach((p, i) => productReport.push({ id: id("PROD", i + 1, 6), ...p.report }))

// ─── Customers ──────────────────────────────────────────────────────────────

const customerReport: Record<string, unknown>[] = []
const customers = lines<OldCustomer>("customers.json")
  .map((c) => ({ c, createdAt: c.createdAt ? oldDate(c.createdAt) : oidTime(c._id) }))
  .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || byOld(a.c, b.c))
  .map(({ c, createdAt }, i) => {
    const issues: string[] = []
    const vatNumber = text(c.vatNumber)?.replace(/\s+/g, "") ?? null
    const tinNumber = text(c.tinNumber)?.replace(/\s+/g, "") ?? null
    const pvNumber = text(c.companyPV_number)?.replace(/^(PV\s*[-/_ ]?\s*)?(?=\d+$)/i, "PV-") ?? null
    const email = text(c.email)?.toLowerCase() ?? null
    if (vatNumber && !/^\d{9}-\d{4}$/.test(vatNumber)) issues.push(`VAT number "${vatNumber}" isn't 123456789-7000`)
    if (tinNumber && !/^\d{9}$/.test(tinNumber)) issues.push(`TIN "${tinNumber}" isn't 9 digits`)
    if (pvNumber && !/^PV-\d+$/.test(pvNumber)) issues.push(`PV number "${pvNumber}" isn't PV-123`)
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) issues.push(`email "${email}" looks invalid`)

    const phones = phoneList(c.telephone)
    const contactPhones = phoneList(c.contactPersonMobile)
    if (phones.dropped.length) issues.push(`phone parts dropped: ${phones.dropped.join(" | ")}`)
    if (contactPhones.dropped.length) issues.push(`contact phone parts dropped: ${contactPhones.dropped.join(" | ")}`)

    const name = c.name.trim()
    const title = text(c.title)
    const type =
      c.customerClassification ?? (/\b(pvt|ltd|limited|plc|private)\b/i.test(name) || title === "M/s." || vatNumber ? "B2B" : "B2C")
    if (!c.customerClassification) issues.push(`type guessed: ${type}`)

    const structured = text(c.houseNumber) || text(c.street) || text(c.city)
    const row = {
      id: id("CUST", i + 1, 6),
      code: c.code.trim(),
      type,
      title,
      name,
      email,
      phones: phones.kept,
      houseNumber: text(c.houseNumber),
      street: structured ? text(c.street) : text(c.address),
      city: text(c.city),
      district: text(c.district),
      province: text(c.province),
      country: text(c.country) ?? "Sri Lanka",
      contactPerson: text(c.contactPerson),
      contactPhones: contactPhones.kept,
      vatNumber,
      tinNumber,
      pvNumber,
      seaRegistrationNumber: text(c.seaRegistrationNumber),
      isCommissioned: c.isCommissioned === true,
      isActive: !(c.status === "inactive" || c.archived === true),
      notes: text(c.notes),
      createdAt,
    }
    customerReport.push({ id: row.id, code: row.code, name, type, issues: issues.join("; ") })
    return row
  })

// ─── Suppliers ──────────────────────────────────────────────────────────────

const supplierReport: Record<string, unknown>[] = []
const suppliers = lines<OldSupplier>("suppliers.json")
  .sort(byOld)
  .map((s, i) => {
    const phones = phoneList(s.telephone)
    const address = s.address.trim()
    const country = /china|xiamn/i.test(address) ? "China" : /emirates/i.test(address) ? "United Arab Emirates" : /hong ?kong/i.test(address) ? "Hong Kong" : "Sri Lanka"
    const row = {
      id: id("SUP", i + 1, 5),
      code: s.code.trim(),
      name: s.name.trim(),
      phones: phones.kept,
      email: text(s.email)?.toLowerCase() ?? null,
      street: address,
      country,
      vatNumber: text(s.vatNumber)?.replace(/\s+/g, "") ?? null,
      createdAt: oidTime(s._id),
    }
    supplierReport.push({ id: row.id, code: row.code, name: row.name, country, issues: phones.dropped.length ? `phone parts dropped: ${phones.dropped.join(" | ")}` : "" })
    return row
  })

// ─── Report ─────────────────────────────────────────────────────────────────

writeFileSync(path.join(dir, "report-products.csv"), csv(productReport))
writeFileSync(path.join(dir, "report-customers.csv"), csv(customerReport))
writeFileSync(path.join(dir, "report-suppliers.csv"), csv(supplierReport))

const count = <T>(rows: T[], pick: (r: T) => unknown) =>
  Object.fromEntries([...rows.reduce((m, r) => m.set(String(pick(r)), (m.get(String(pick(r))) ?? 0) + 1), new Map<string, number>())])
console.log(`Products: ${products.length} (from ${oldProducts.length} documents), ${products.filter((p) => p.row.isDeleted).length} deleted`)
console.log("  title from:", count(productReport, (r) => r.titleFrom))
console.log("  category from:", count(productReport, (r) => r.categoryFrom))
console.log("  warranty from:", count(productReport, (r) => r.warrantyFrom))
console.log("  tracking:", count(products, (p) => p.row.trackingType))
console.log("  with issues:", productReport.filter((r) => r.issues).length)
console.log(`Customers: ${customers.length}, types:`, count(customers, (c) => c.type), "inactive:", customers.filter((c) => !c.isActive).length)
console.log("  with issues:", customerReport.filter((r) => r.issues).length)
console.log(`Suppliers: ${suppliers.length}`)
console.log(`Reports: ${path.join(dir, "report-*.csv")}`)

// ─── Write ──────────────────────────────────────────────────────────────────

// Children before parents isn't needed: TRUNCATE empties them all at once. RESTART IDENTITY resets the integer ids.
const WIPE = [
  "Approval", "GoodsReceivedNoteItem", "GoodsReceivedNote", "PurchaseOrderItem", "PurchaseOrder", "InternalRequisitionItem",
  "InternalRequisition", "DeliveryNote", "InvoiceItem", "Invoice", "QuotationItem", "Quotation", "NumberSequence",
  "StockMovement", "PriceMovement", "CostMovement", "Product", "Customer", "Supplier",
]
const DOCUMENT_NUMBER_SEQUENCES = ["quotation_number_seq", "delivery_note_number_seq", "internal_requisition_number_seq", "purchase_order_number_seq", "grn_number_seq"]
const REMARKS = "Imported from the old system"

class RolledBack extends Error {}

if (mode !== "report") {
  try {
    await db.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(`TRUNCATE ${WIPE.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY`)
        const setSequence = (name: string, last: number) => tx.$executeRawUnsafe(`SELECT setval('${name}', ${Math.max(last, 1)}, ${last > 0})`)
        for (const seq of DOCUMENT_NUMBER_SEQUENCES) await setSequence(seq, 0)

        // Categories stay; ones Contentful has that are missing are added, numbered on from the highest existing id.
        const categories = await tx.category.findMany()
        await setSequence("category_number_seq", Math.max(0, ...categories.map((c) => Number(c.id.replace(/\D/g, "")))))
        const categoryIds = new Map(categories.map((c) => [c.name.toLowerCase(), c.id]))
        for (const name of [...new Set(products.map((p) => p.row.category))].sort()) {
          if (categoryIds.has(name.toLowerCase())) continue
          const created = await tx.category.create({ data: { name } })
          categoryIds.set(name.toLowerCase(), created.id)
          console.log(`Added category ${created.id} ${name}`)
        }

        const productRows = products.map(({ row: { category, ...row } }, i) => ({ ...row, id: id("PROD", i + 1, 6), categoryId: categoryIds.get(category.toLowerCase())! }))
        await tx.product.createMany({ data: productRows })
        await tx.priceMovement.createMany({ data: productRows.map((p) => ({ productId: p.id, previousPrice: null, price: p.price, remarks: REMARKS })) })
        await tx.costMovement.createMany({ data: productRows.map((p) => ({ productId: p.id, previousCost: null, cost: p.cost, remarks: REMARKS })) })
        await tx.stockMovement.createMany({
          data: productRows.flatMap((p) => [
            ...(p.stockInHand ? [{ productId: p.id, bucket: "inHand" as const, quantity: p.stockInHand, balanceAfter: p.stockInHand, remarks: REMARKS }] : []),
            ...(p.stockInTransit ? [{ productId: p.id, bucket: "inTransit" as const, quantity: p.stockInTransit, balanceAfter: p.stockInTransit, remarks: REMARKS }] : []),
          ]),
        })
        await tx.customer.createMany({ data: customers })
        await tx.supplier.createMany({ data: suppliers })
        await setSequence("product_number_seq", productRows.length)
        await setSequence("customer_number_seq", customers.length)
        await setSequence("supplier_number_seq", suppliers.length)

        if (mode === "dry-run") throw new RolledBack()
      },
      { maxWait: 60_000, timeout: 15 * 60_000 },
    )
    console.log("Committed.")
  } catch (err) {
    if (!(err instanceof RolledBack)) throw err
    console.log("Dry run: everything was written and then rolled back. Run with --apply to keep it.")
  } finally {
    await db.$disconnect()
  }
}
