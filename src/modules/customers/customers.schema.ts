import { z } from "zod"
import { pageQuery, pageResult } from "#http/pagination.js"

const customerId = z.string().regex(/^CUST\d{6,}$/, "Must be a customer id like CUST000001")

export const customerIdParams = z.object({ id: customerId })

export const customerType = z.enum(["B2B", "B2C"])

export const customer = z.object({
  id: z.string(),
  code: z.string(),
  type: customerType,
  title: z.string().nullable(),
  name: z.string(),
  email: z.string().nullable(),
  phones: z.array(z.string()),
  houseNumber: z.string().nullable(),
  street: z.string().nullable(),
  city: z.string().nullable(),
  district: z.string().nullable(),
  province: z.string().nullable(),
  country: z.string(),
  contactPerson: z.string().nullable(),
  contactPhones: z.array(z.string()),
  vatNumber: z.string().nullable(),
  tinNumber: z.string().nullable(),
  pvNumber: z.string().nullable(),
  isCommissioned: z.boolean(),
  isActive: z.boolean().describe("Set by the system: last invoice less than 6 months ago"),
  isDormant: z.boolean().describe("Set by the system: last invoice over 18 months ago"),
  lastInvoiceDate: z.date().nullable().describe("Set by the system"),
  totalInvoices: z.number().int().describe("Set by the system"),
  notes: z.string().nullable(),
  createdBy: z.string().nullable(),
  createdAt: z.date(),
  modifiedBy: z.string().nullable(),
  modifiedAt: z.date().nullable(),
  isDeleted: z.boolean(),
})

export const customerPage = pageResult(customer)

export const listCustomersQuery = pageQuery.extend({
  q: z.string().trim().min(1).optional().describe("Case-insensitive partial match on code, name or email"),
  city: z.string().trim().min(1).optional().describe("Exact match on city"),
  district: z.string().trim().min(1).optional().describe("Exact match on district"),
  includeDeleted: z.stringbool().default(false).describe("Include deleted customers"),
})

const phone = z.string().trim().regex(/^\+?\d{7,15}$/, "Must be a phone number like +94771234567, with no spaces")

// Fields a client may send. isActive, isDormant, lastInvoiceDate and totalInvoices are set by the system from invoices,
// so they aren't here: zod drops them from a request.
const customerFields = z.object({
  code: z.string().trim().min(1).max(64),
  type: customerType,
  title: z.string().trim().min(1).max(20).nullable(),
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().toLowerCase().pipe(z.email()).nullable(),
  phones: z.array(phone).max(10),
  houseNumber: z.string().trim().min(1).max(50).nullable(),
  street: z.string().trim().min(1).max(200).nullable(),
  city: z.string().trim().min(1).max(100).nullable(),
  district: z.string().trim().min(1).max(100).nullable(),
  province: z.string().trim().min(1).max(100).nullable(),
  country: z.string().trim().min(1).max(100),
  contactPerson: z.string().trim().min(1).max(200).nullable(),
  contactPhones: z.array(phone).max(10),
  vatNumber: z.string().trim().regex(/^\d{9}-\d{4}$/, "Must be a VAT number like 109860522-7000").nullable(),
  tinNumber: z.string().trim().regex(/^\d{9}$/, "Must be a TIN number like 109860522").nullable(),
  pvNumber: z.string().trim().regex(/^PV-\d+$/, "Must be a PV number like PV-00300617").nullable(),
  isCommissioned: z.boolean(),
  notes: z.string().trim().min(1).max(2000).nullable(),
})

export const createCustomerBody = customerFields.extend({
  title: customerFields.shape.title.default(null),
  email: customerFields.shape.email.default(null),
  phones: customerFields.shape.phones.default([]),
  houseNumber: customerFields.shape.houseNumber.default(null),
  street: customerFields.shape.street.default(null),
  city: customerFields.shape.city.default(null),
  district: customerFields.shape.district.default(null),
  province: customerFields.shape.province.default(null),
  contactPerson: customerFields.shape.contactPerson.default(null),
  contactPhones: customerFields.shape.contactPhones.default([]),
  vatNumber: customerFields.shape.vatNumber.default(null),
  tinNumber: customerFields.shape.tinNumber.default(null),
  pvNumber: customerFields.shape.pvNumber.default(null),
  isCommissioned: customerFields.shape.isCommissioned.default(false),
  notes: customerFields.shape.notes.default(null),
})

// From the fields without defaults (see the pitfall in AGENTS.md).
export const updateCustomerBody = customerFields
  .extend({ isDeleted: z.boolean().describe("true = deleted: hidden from lists by default") })
  .partial()

export type ListCustomersQuery = z.infer<typeof listCustomersQuery>
export type CreateCustomerBody = z.infer<typeof createCustomerBody>
export type UpdateCustomerBody = z.infer<typeof updateCustomerBody>
