import { z } from "zod"
import { COUNTRY_CODES } from "./countries.js"

/** A country field in requests: the ISO 3166-1 alpha-3 code, any case ("lka" → "LKA"). */
export const countryCode = z
  .string()
  .trim()
  .toUpperCase()
  .refine((code) => COUNTRY_CODES.has(code), "Must be an ISO 3166-1 alpha-3 country code, e.g. LKA")

export const countryList = z.array(z.object({ code: z.string().describe("ISO 3166-1 alpha-3, e.g. LKA"), name: z.string() }))
