import { z } from "zod"

const isTimeZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz })
    return true
  } catch {
    return false
  }
}
const currencies = new Set(Intl.supportedValuesOf("currency"))
const regions = new Intl.DisplayNames(["en"], { type: "region" })

export const currency = z
  .string()
  .toUpperCase()
  .refine((c) => currencies.has(c), "Must be an ISO 4217 currency code, e.g. LKR")
export const country = z
  .string()
  .toUpperCase()
  .refine((c) => /^[A-Z]{2}$/.test(c) && regions.of(c) !== c, "Must be an ISO 3166-1 alpha-2 country code, e.g. LK")
export const timezone = z.string().refine(isTimeZone, "Must be an IANA time zone, e.g. Asia/Colombo")

export const settingsResponse = z.object({
  currency: z.string(),
  country: z.string(),
  timezone: z.string(),
  modifiedAt: z.iso.datetime().nullable().describe("null until the settings are first changed"),
  serverTime: z.iso.datetime().describe("Current server time in UTC; use with `timezone` to show local time"),
})

export const updateSettingsBody = z
  .object({ currency, country, timezone })
  .partial()
  .refine((body) => Object.keys(body).length > 0, "Provide at least one setting to update")

export type SettingsResponse = z.infer<typeof settingsResponse>
export type UpdateSettingsBody = z.infer<typeof updateSettingsBody>
