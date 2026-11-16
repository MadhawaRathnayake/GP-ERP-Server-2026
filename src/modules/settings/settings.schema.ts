import { z } from "zod"
import { countryCode } from "#modules/countries/countries.schema.js"

const isTimeZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz })
    return true
  } catch {
    return false
  }
}
const currencies = new Set(Intl.supportedValuesOf("currency"))

export const currency = z
  .string()
  .toUpperCase()
  .refine((c) => currencies.has(c), "Must be an ISO 4217 currency code, e.g. LKR")
export const timezone = z.string().refine(isTimeZone, "Must be an IANA time zone, e.g. Asia/Colombo")
export const vatRate = z
  .number()
  .min(0)
  .max(100)
  .refine((n) => Math.round(n * 100) / 100 === n, "Must have at most 2 decimals, e.g. 18 or 7.5")
  .describe("VAT percent, copied onto each quotation line when it's saved")

export const settingsResponse = z.object({
  currency: z.string(),
  country: z.string(),
  timezone: z.string(),
  vatRate: z.number().describe("VAT percent, e.g. 18"),
  modifiedAt: z.iso.datetime().nullable().describe("null until the settings are first changed"),
  serverTime: z.iso.datetime().describe("Current server time in UTC; use with `timezone` to show local time"),
})

export const updateSettingsBody = z
  .object({ currency, country: countryCode, timezone, vatRate })
  .partial()
  .refine((body) => Object.keys(body).length > 0, "Provide at least one setting to update")

export type SettingsResponse = z.infer<typeof settingsResponse>
export type UpdateSettingsBody = z.infer<typeof updateSettingsBody>
