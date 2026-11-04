import { env } from "#config/env.js"
import type { Setting } from "#generated/prisma/client.js"
import { cache } from "#cache/cache.js"
import { db } from "#core/db.js"
import type { Actor } from "#security/auth.plugin.js"
import type { UpdateSettingsBody } from "./settings.schema.js"

export interface Settings {
  currency: string
  country: string
  timezone: string
  vatRate: number // percent; a number, not a Decimal, because the settings are cached as JSON
  modifiedAt: string | null
}

const toSettings = ({ currency, country, timezone, vatRate, modifiedAt }: Setting): Settings => ({
  currency,
  country,
  timezone,
  vatRate: vatRate.toNumber(),
  modifiedAt: modifiedAt?.toISOString() ?? null,
})

/**
 * Company-wide settings. Use anywhere:  const { currency, timezone } = await getSettings()
 * Cached in Redis and dropped on any change to the Setting table. The row is created from .env defaults on first use.
 */
export function getSettings(): Promise<Settings> {
  return cache.remember({ tables: ["Setting"], key: "settings" }, async () =>
    toSettings(
      await db.setting.upsert({
        where: { id: 1 },
        update: {},
        create: {
          id: 1,
          currency: env.DEFAULT_CURRENCY,
          country: env.DEFAULT_COUNTRY,
          timezone: env.DEFAULT_TIMEZONE,
          vatRate: env.DEFAULT_VAT_RATE,
        },
      }),
    ),
  )
}

export async function updateSettings(data: UpdateSettingsBody, actor: Actor): Promise<Settings> {
  await getSettings() // make sure the row exists
  return toSettings(await db.setting.update({ where: { id: 1 }, data: { ...data, modifiedBy: actor.id, modifiedAt: new Date() } }))
}
