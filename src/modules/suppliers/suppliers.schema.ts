import { z } from "zod"
import { pageQuery, pageResult } from "#http/pagination.js"

const supplierId = z.string().regex(/^SUP\d{5,}$/, "Must be a supplier id like SUP00001")

export const supplierIdParams = z.object({ id: supplierId })

export const supplier = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  phones: z.array(z.string()),
  email: z.string().nullable(),
  houseNumber: z.string().nullable(),
  street: z.string().nullable(),
  city: z.string().nullable(),
  district: z.string().nullable(),
  province: z.string().nullable(),
  country: z.string(),
  vatNumber: z.string().nullable(),
  tinNumber: z.string().nullable(),
  pvNumber: z.string().nullable(),
  createdBy: z.string().nullable(),
  createdAt: z.date(),
  modifiedBy: z.string().nullable(),
  modifiedAt: z.date().nullable(),
  isDeleted: z.boolean(),
})

export const supplierPage = pageResult(supplier)

export const listSuppliersQuery = pageQuery.extend({
  q: z.string().trim().min(1).optional().describe("Case-insensitive partial match on code, name or email"),
  includeDeleted: z.stringbool().default(false).describe("Include deleted suppliers"),
})

const phone = z.string().trim().regex(/^\+?\d{7,15}$/, "Must be a phone number like +94771234567, with no spaces")

const supplierFields = z.object({
  code: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(200),
  phones: z.array(phone).max(10),
  email: z.string().trim().toLowerCase().pipe(z.email()).nullable(),
  houseNumber: z.string().trim().min(1).max(50).nullable(),
  street: z.string().trim().min(1).max(200).nullable(),
  city: z.string().trim().min(1).max(100).nullable(),
  district: z.string().trim().min(1).max(100).nullable(),
  province: z.string().trim().min(1).max(100).nullable(),
  country: z.string().trim().min(1).max(100),
  vatNumber: z.string().trim().regex(/^\d{9}-\d{4}$/, "Must be a VAT number like 109860522-7000").nullable(),
  tinNumber: z.string().trim().regex(/^\d{9}$/, "Must be a TIN number like 109860522").nullable(),
  pvNumber: z.string().trim().regex(/^PV-\d+$/, "Must be a PV number like PV-00300617").nullable(),
})

export const createSupplierBody = supplierFields.extend({
  phones: supplierFields.shape.phones.default([]),
  email: supplierFields.shape.email.default(null),
  houseNumber: supplierFields.shape.houseNumber.default(null),
  street: supplierFields.shape.street.default(null),
  city: supplierFields.shape.city.default(null),
  district: supplierFields.shape.district.default(null),
  province: supplierFields.shape.province.default(null),
  vatNumber: supplierFields.shape.vatNumber.default(null),
  tinNumber: supplierFields.shape.tinNumber.default(null),
  pvNumber: supplierFields.shape.pvNumber.default(null),
})

// From the fields without defaults (see the pitfall in AGENTS.md).
export const updateSupplierBody = supplierFields
  .extend({ isDeleted: z.boolean().describe("true = deleted: hidden from lists by default") })
  .partial()

export type ListSuppliersQuery = z.infer<typeof listSuppliersQuery>
export type CreateSupplierBody = z.infer<typeof createSupplierBody>
export type UpdateSupplierBody = z.infer<typeof updateSupplierBody>
