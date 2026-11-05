import { z } from "zod"

// Every permission in the app, grouped by screen. This is the source of truth: the Permission table is filled from it
// at boot (permissions-sync.plugin.ts), and roles are granted rows of that table. A user has the permissions of their role.
//
//   Backend:   config: { permission: "PRODUCTS.CREATE" }        on a route → 403 without it
//   Frontend:  GET /api/v1/auth/me → permissions: ["PRODUCTS.VIEW", …]; show a screen when the user has <SCREEN>.VIEW
//
// To add one: add a line here, put it on a route, grant it to a role. A typo in a route is a compile error.
export const PERMISSIONS = {
  ADMIN: {
    VIEW: "Open the admin screen (users and roles)",
    MANAGE_USERS: "Create, edit and deactivate users",
    MANAGE_ROLES: "Create and edit roles",
    EDIT_SETTINGS: "Change company settings (currency, country, timezone)",
  },
  DROPDOWNS: {
    VIEW: "See which users each dropdown offers (admin screen)",
    EDIT: "Choose which users each dropdown offers, e.g. sales managers",
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

/** An admin can never remove this from themselves, so there is always someone who can manage users. */
export const USER_ADMIN_PERMISSION: PermissionKey = "ADMIN.MANAGE_USERS"

export const toPermissionKey = ({ screenCode, permissionCode }: { screenCode: string; permissionCode: string }) =>
  `${screenCode}.${permissionCode}`

export const isPermissionKey = (key: string): key is PermissionKey => (PERMISSION_KEYS as string[]).includes(key)

export const permissionKeySchema = z.enum(PERMISSION_KEYS)

/** Permission keys in request bodies; duplicates are dropped. */
export const permissionKeysInput = z.array(permissionKeySchema).transform((keys) => [...new Set(keys)])
