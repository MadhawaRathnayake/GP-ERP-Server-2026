import { z } from "zod"

// Every permission in the app, grouped by screen. This is the source of truth: the Permission table is filled from it
// at boot (permissions-sync.plugin.ts), and roles are granted rows of that table. A user has the permissions of their role.
//
//   Backend:   config: { permission: "PRODUCTS.CREATE" }        on a route → 403 without it
//   Frontend:  GET /api/v1/auth/me → permissions: ["PRODUCTS.VIEW", …]; show a screen when the user has <SCREEN>.VIEW
//
// To add one: add a line here, put it on a route, grant it to a role. A typo in a route is a compile error.
export const PERMISSIONS = {
  // The admin screen shows the cards of the groups below that the user can view. Users and roles: an admin manages only
  // the roles under their own role and the users in them (modules/roles/roles.access.ts).
  USERS: {
    VIEW: "See users (admin screen)",
    CREATE: "Create users in the roles under your own role",
    EDIT: "Edit and deactivate users in the roles under your own role",
  },
  ROLES: {
    VIEW: "See roles and their permissions (admin screen)",
    CREATE: "Create roles under your own role",
    EDIT: "Edit the roles under your own role, giving them only permissions your own role has",
  },
  SETTINGS: {
    VIEW: "See company settings (admin screen)",
    EDIT: "Change company settings (currency, country, timezone, VAT)",
  },
  DROPDOWNS: {
    VIEW: "See which users each dropdown offers (admin screen)",
    EDIT: "Choose which users each dropdown offers, e.g. sales managers",
  },
  APPROVALS: {
    VIEW: "See which screens need approval (admin screen)",
    EDIT: "Turn approval on or off per screen",
  },
  DASHBOARD: { VIEW: "Open the dashboard" },
  PRODUCTS: {
    VIEW: "View products",
    CREATE: "Create products",
    EDIT: "Edit products",
    DELETE: "Delete products",
  },
  CATEGORY: {
    VIEW: "View category",
    CREATE: "Create category",
    EDIT: "Edit category",
    DELETE: "Delete category",
  },
  CUSTOMERS: { 
    VIEW: "View customers",
    CREATE: "Create customers",
    EDIT: "Edit customers",
    DELETE: "Delete customers"
  },
  SUPPLIERS: {
    VIEW: "View suppliers",
    CREATE: "Create suppliers",
    EDIT: "Edit suppliers",
    DELETE: "Delete suppliers",
  },
  QUOTATIONS: {
    VIEW: "View quotations",
    CREATE: "Create quotations",
    EDIT: "Edit the details and lines of active quotations",
    DELETE: "Delete quotations",
    RESTORE: "Restore deleted quotations",
    CONFIRM_PAYMENT: "Confirm payment for quotations",
    CONFIRM_CREDIT: "Confirm credit for quotations",
    UNDO_CONFIRMATION: "Undo a payment or credit confirmation (also needed to reopen one cancelled after it)",
    CANCEL: "Cancel quotations",
    REOPEN: "Reopen cancelled quotations",
  },
  INVOICES: {
    VIEW: "View invoices",
    CREATE: "Create an invoice from a confirmed quotation",
    CREATE_DIRECT: "Create an invoice without a quotation",
    EDIT: "Edit draft invoices: prices, discounts, lines, payment and notes",
    FINALIZE: "Finalize draft invoices (gives the invoice number and moves the stock)",
    CANCEL: "Cancel invoices (gives back the stock and the quotation)",
  },
  DELIVERY_NOTES: {
    VIEW: "View delivery notes",
    SET_VERIFIER: "Add or change the item verifier of draft delivery notes",
    SET_ISSUER: "Add the item issuer, which issues the delivery note",
  },
  INTERNAL_REQUISITIONS: {
    VIEW: "View internal requisitions",
    CREATE: "Create internal requisitions",
    EDIT: "Edit pending and rejected internal requisitions (editing a rejected one resubmits it)",
    APPROVE: "Approve pending internal requisitions",
    REJECT: "Reject pending internal requisitions, with a reason",
    CANCEL: "Cancel internal requisitions, with a reason",
  },
  PURCHASE_ORDERS: {
    VIEW: "View purchase orders",
    CREATE: "Create a purchase order from a local internal requisition (from a pending one also needs Approve internal requisitions)",
    EDIT: "Edit pending and rejected purchase orders (editing a rejected one resubmits it)",
    APPROVE: "Approve pending purchase orders",
    REJECT: "Reject pending purchase orders, with a reason",
    CANCEL: "Cancel purchase orders, with a reason (also cancels the internal requisition)",
  },
  GOODS_RECEIVED_NOTES: {
    VIEW: "View goods received notes (GRNs)",
    CREATE: "Create a GRN from an approved purchase order or an approved international internal requisition",
    EDIT: "Edit pending and rejected GRNs (editing a rejected one resubmits it)",
    APPROVE: "Approve pending GRNs (adds the received goods to stock)",
    REJECT: "Reject pending GRNs, with a reason",
    CANCEL: "Cancel pending and rejected GRNs, with a reason",
  },
  REPORTS: { VIEW: "Open reports" },
} as const satisfies Record<string, Record<string, string>>

export type ScreenCode = keyof typeof PERMISSIONS

/** "SCREEN.PERMISSION", e.g. "PRODUCTS.CREATE" */
export type PermissionKey = {
  [S in ScreenCode]: `${S}.${Extract<keyof (typeof PERMISSIONS)[S], string>}`
}[ScreenCode]

export interface PermissionDefinition {
  key: PermissionKey
  screenCode: ScreenCode
  permissionCode: string
  description: string
}

export const PERMISSION_DEFINITIONS: PermissionDefinition[] = Object.entries(PERMISSIONS).flatMap(([screenCode, codes]) =>
  Object.entries(codes).map(([permissionCode, description]) => ({
    key: `${screenCode}.${permissionCode}` as PermissionKey,
    screenCode: screenCode as ScreenCode,
    permissionCode,
    description,
  })),
)

const PERMISSION_KEYS = PERMISSION_DEFINITIONS.map((p) => p.key) as [PermissionKey, ...PermissionKey[]]

/**
 * Permission groups only the Super Admin can grant or take away, on any role. An admin can't give them to the roles
 * under them even when their own role has them.
 */
export const SUPER_ADMIN_ONLY_SCREENS: readonly ScreenCode[] = ["SETTINGS", "DROPDOWNS", "APPROVALS"]

export const isSuperAdminOnly = (key: PermissionKey) => SUPER_ADMIN_ONLY_SCREENS.some((screen) => key.startsWith(`${screen}.`))

export const toPermissionKey = ({ screenCode, permissionCode }: { screenCode: string; permissionCode: string }) =>
  `${screenCode}.${permissionCode}`

export const isPermissionKey = (key: string): key is PermissionKey => (PERMISSION_KEYS as string[]).includes(key)

export const permissionKeySchema = z.enum(PERMISSION_KEYS)

/** Permission keys in request bodies; duplicates are dropped. */
export const permissionKeysInput = z.array(permissionKeySchema).transform((keys) => [...new Set(keys)])
