import { Prisma, type QuotationStatus, type QuotationType } from "#generated/prisma/client.js"
import { db } from "#core/db.js"
import { BadRequestError, ForbiddenError, NotFoundError } from "#http/errors.js"
import { paginate } from "#http/pagination.js"
import type { Actor } from "#security/auth.plugin.js"
import type { PermissionKey } from "#security/permissions.js"
import { dropdownUsers, isDropdownUser } from "#modules/dropdowns/dropdowns.service.js"
import { getSettings } from "#modules/settings/settings.service.js"
import { lineAmounts, quotationTotals, roundMoney } from "./quotations.amounts.js"
import { QuotationInvoicedError, QuotationNotActiveError } from "./quotations.errors.js"
import { permissionsForChange } from "./quotations.permissions.js"
import { fieldsNotAllowed } from "./quotations.types.js"
import type { CreateQuotationBody, ListQuotationsQuery, QuotationItemInput, UpdateQuotationBody } from "./quotations.schema.js"

// A quotation and its lines are saved together. The server works out every amount from the lines (quotations.amounts.ts)
// and copies the product's cost and the VAT rate onto each line, so a saved quotation never changes when they do.
// Saving new lines soft-deletes the old ones. Only an active quotation can be edited or deleted; its status can change
// until it's invoiceCreated, after which nothing can.

const summaryInclude = {
  customer: { select: { id: true, code: true, name: true } },
  salesManager: { select: { id: true, name: true } },
} satisfies Prisma.QuotationInclude

// The detail also carries what the printed quotation shows about the customer and each product, so printing it needs
// only QUOTATIONS.VIEW.
const detailInclude = {
  ...summaryInclude,
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
      contactPerson: true,
      contactPhones: true,
      vatNumber: true,
    },
  },
  items: {
    where: { isDeleted: false },
    orderBy: { lineNo: "asc" },
    include: { product: { select: { sku: true, description: true, imageUrl: true } } },
  },
} satisfies Prisma.QuotationInclude

export type QuotationDetail = Prisma.QuotationGetPayload<{ include: typeof detailInclude }>

export function listQuotations({ customerId, salesManagerId, status, type, from, to, includeDeleted, ...page }: ListQuotationsQuery) {
  const where: Prisma.QuotationWhereInput = {
    ...(customerId && { customerId }),
    ...(salesManagerId && { salesManagerId }),
    ...(status && { status }),
    ...(type && { type }),
    ...((from || to) && { quotationDate: { ...(from && { gte: from }), ...(to && { lte: to }) } }),
    ...(!includeDeleted && { isDeleted: false }),
  }
  return paginate(
    page,
    (args) => db.quotation.findMany({ where, include: summaryInclude, orderBy: { id: "desc" }, ...args }),
    () => db.quotation.count({ where }),
  )
}

export async function getQuotation(id: number): Promise<QuotationDetail> {
  const quotation = await db.quotation.findUnique({ where: { id }, include: detailInclude })
  if (!quotation) throw new NotFoundError("Quotation", String(id))
  return quotation
}

/** The users who can be picked as a quotation's sales manager (Admin → Dropdowns). */
export const listSalesManagers = () => dropdownUsers("SALES_MANAGER")

export async function createQuotation({ items, ...data }: CreateQuotationBody, actor: Actor) {
  const { timezone, vatRate } = await getSettings()
  const quotationDate = data.quotationDate ?? today(timezone)
  assertValidUntil(quotationDate, data.validUntil)
  await assertActiveCustomer(data.customerId)
  await assertSalesManager(data.salesManagerId)
  const lines = await buildLines(items, vatRate)

  const { id } = await db.$transaction(async (tx) => {
    const quotation = await tx.quotation.create({
      data: { ...data, quotationDate, ...quotationTotals(lines), createdBy: actor.id },
    })
    await tx.quotationItem.createMany({ data: lines.map((line) => ({ ...line, quotationId: quotation.id, createdBy: actor.id })) })
    return quotation
  })
  return getQuotation(id)
}

// Sending `items` replaces every line and recalculates the totals, with the current product cost and VAT rate.
// The customer and sales manager are checked only when they change, so an edit form can send them back unchanged after
// the customer was deleted or the manager removed from the dropdown.
// Each change needs its own permission (quotations.permissions.ts), checked against `permissions`, the actor's.
export async function updateQuotation(
  id: number,
  { items, ...data }: UpdateQuotationBody,
  actor: Actor,
  permissions: readonly PermissionKey[],
) {
  const changesContent =
    items !== undefined || Object.entries(data).some(([key, value]) => value !== undefined && key !== "status" && key !== "isDeleted")
  const lines = items && (await buildLines(items, (await getSettings()).vatRate))

  await db.$transaction(async (tx) => {
    // Locks the row, so two edits at once can't both replace the lines.
    await tx.$executeRaw`SELECT 1 FROM "Quotation" WHERE id = ${id} FOR UPDATE`
    const before = await tx.quotation.findUnique({
      where: { id },
      select: {
        status: true,
        isDeleted: true,
        customerId: true,
        salesManagerId: true,
        quotationDate: true,
        validUntil: true,
        type: true,
        repairReceiveNoteId: true,
        troubleshootId: true,
        oldInvoiceId: true,
        oldSerialNumberId: true,
        productModel: true,
      },
    })
    if (!before) throw new NotFoundError("Quotation", String(id))
    if (before.status === "invoiceCreated") throw new QuotationInvoicedError(id)

    const status = data.status === "cancelled" ? cancelledStatus(before.status) : data.status
    const after = { status: status ?? before.status, isDeleted: data.isDeleted ?? before.isDeleted }
    const missing = permissionsForChange(before, after, changesContent).find((key) => !permissions.includes(key))
    if (missing) throw new ForbiddenError(missing)


    if ((changesContent || data.isDeleted === true) && before.status !== "active") throw new QuotationNotActiveError(id)
    assertValidUntil(data.quotationDate ?? before.quotationDate, data.validUntil === undefined ? before.validUntil : data.validUntil)
    if (data.customerId && data.customerId !== before.customerId) await assertActiveCustomer(data.customerId)
    if (data.salesManagerId && data.salesManagerId !== before.salesManagerId) await assertSalesManager(data.salesManagerId)
    // Against the saved values: changing the type means sending null for the fields the new type can't have.
    assertTypeFields(data.type ?? before.type, { ...before, ...data })

    const modified = { modifiedBy: actor.id, modifiedAt: new Date() }
    if (lines) {
      await tx.quotationItem.updateMany({ where: { quotationId: id, isDeleted: false }, data: { isDeleted: true, ...modified } })
      await tx.quotationItem.createMany({ data: lines.map((line) => ({ ...line, quotationId: id, createdBy: actor.id })) })
    }
    await tx.quotation.update({ where: { id }, data: { ...data, status, ...(lines && quotationTotals(lines)), ...modified } })
  })
  return getQuotation(id)
}

/**
 * Only an active quotation can be deleted. It's soft-deleted and its lines left as they are, so
 * `PATCH { isDeleted: false }` restores it as it was.
 */
export async function deleteQuotation(id: number, actor: Actor) {
  // The DELETE route already required QUOTATIONS.DELETE.
  await updateQuotation(id, { isDeleted: true }, actor, ["QUOTATIONS.DELETE"])
}

/**
 * The status a cancelled quotation gets: it keeps the confirmation it had (cancelledAfterCredit/Payment), so the
 * client still sees how far it got. Cancelling one that's already cancelled leaves it as it is.
 */
function cancelledStatus(current: QuotationStatus): QuotationStatus {
  switch (current) {
    case "creditConfirmed":
      return "cancelledAfterCredit"
    case "paymentConfirmed":
      return "cancelledAfterPayment"
    case "cancelledAfterCredit":
    case "cancelledAfterPayment":
      return current
    default:
      return "cancelled"
  }
}

/** Each line with the product's title, price and cost filled in, the VAT rate, and its amounts. */
async function buildLines(items: QuotationItemInput[], vatRate: number) {
  const productIds = [...new Set(items.map((item) => item.productId))]
  const products = await db.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, title: true, price: true, cost: true, isDeleted: true },
  })
  const byId = new Map(products.map((product) => [product.id, product]))
  const taxRate = new Prisma.Decimal(vatRate)

  return items.map((item, index) => {
    const lineNo = index + 1
    const product = byId.get(item.productId)
    if (!product || product.isDeleted) throw new BadRequestError(`Line ${lineNo}: product ${item.productId} doesn't exist or is deleted`)
    const pricing = {
      quantity: item.quantity,
      unitPrice: roundMoney(item.unitPrice ?? product.price),
      discountType: item.discountType,
      discountValue: roundMoney(item.discountValue),
      taxRate,
    }
    const amounts = lineAmounts(pricing)
    if (amounts.discountAmount.gt(amounts.subtotal)) throw new BadRequestError(`Line ${lineNo}: the discount is more than the line subtotal`)
    return {
      lineNo,
      productId: product.id,
      description: item.description ?? product.title,
      unitCost: product.cost,
      ...pricing,
      ...amounts,
    }
  })
}

/** Today's date in the company timezone, as a @db.Date value. */
function today(timezone: string) {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date()) // en-CA gives YYYY-MM-DD
  return new Date(`${day}T00:00:00.000Z`)
}

function assertTypeFields(type: QuotationType, values: Parameters<typeof fieldsNotAllowed>[1]) {
  const fields = fieldsNotAllowed(type, values)
  if (fields.length > 0) throw new BadRequestError(`A ${type} quotation can't have ${fields.join(", ")}`, { fields })
}

function assertValidUntil(quotationDate: Date, validUntil: Date | null | undefined) {
  if (validUntil && validUntil < quotationDate) throw new BadRequestError("validUntil can't be before the quotation date")
}

async function assertActiveCustomer(id: string) {
  const customer = await db.customer.findUnique({ where: { id }, select: { isDeleted: true } })
  if (!customer || customer.isDeleted) throw new BadRequestError(`Customer ${id} doesn't exist or is deleted`)
}

async function assertSalesManager(id: string) {
  if (!(await isDropdownUser("SALES_MANAGER", id))) {
    throw new BadRequestError(`User ${id} isn't one of the sales managers (Admin → Dropdowns)`)
  }
}
