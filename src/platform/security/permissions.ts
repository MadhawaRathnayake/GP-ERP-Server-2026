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
  CUSTOMERS: { VIEW: "View customers" },
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
