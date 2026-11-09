// Every user dropdown an admin can configure, with the label the admin screen shows. To add one: add a line here and
// read it with `dropdownUsers("<CODE>")` in the feature that shows it. No migration: the row is written on first save.
export const USER_DROPDOWNS = {
  SALES_MANAGER: "Sales manager on quotations",
  ITEM_VERIFIER: "Item verifier on delivery notes",
  ITEM_ISSUER: "Item issuer on delivery notes",
} as const satisfies Record<string, string>

export type UserDropdownCode = keyof typeof USER_DROPDOWNS

export const USER_DROPDOWN_CODES = Object.keys(USER_DROPDOWNS) as [UserDropdownCode, ...UserDropdownCode[]]
