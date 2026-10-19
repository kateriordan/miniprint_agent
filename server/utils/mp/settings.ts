import { eq } from "drizzle-orm";
import { db, schema } from "@nuxthub/db";
import { DEFAULT_TIER_CONFIG } from "#shared/miniprint/tiers";
import type { TierConfig } from "#shared/miniprint/tiers";

export async function getOwnerSettings(ownerId: string) {
  const [row] = await db.select().from(schema.ownerSettings).where(eq(schema.ownerSettings.ownerId, ownerId)).limit(1);
  return {
    messengerNames: row?.messengerNames ?? [],
    tierConfig: (row?.tierConfig ?? DEFAULT_TIER_CONFIG) as TierConfig,
  };
}

export async function updateOwnerSettings(ownerId: string, patch: { messengerNames?: string[]; tierConfig?: TierConfig | null }) {
  const current = await getOwnerSettings(ownerId);
  const values = {
    ownerId,
    messengerNames: patch.messengerNames ?? current.messengerNames,
    tierConfig: patch.tierConfig === undefined ? current.tierConfig : patch.tierConfig,
  };
  await db.insert(schema.ownerSettings).values(values)
    .onConflictDoUpdate({ target: schema.ownerSettings.ownerId, set: values });
  return getOwnerSettings(ownerId);
}
