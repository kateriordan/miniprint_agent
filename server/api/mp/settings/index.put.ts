import { z } from "zod";
import { updateOwnerSettings } from "~~/server/utils/mp/settings";
import { requireSessionUserId } from "~~/server/utils/session";

const bodySchema = z.object({
  messengerNames: z.array(z.string().trim().min(1).max(200)).max(10).optional(),
  tierConfig: z.object({
    rarityTiers: z.record(z.string().max(40), z.number().int().min(1).max(10)),
    outOfCirculationTier: z.number().int().min(1).max(10).nullable(),
    labels: z.record(z.string(), z.string().max(40)),
  }).nullable().optional(),
});

export default defineEventHandler(async (event) => {
  const ownerId = await requireSessionUserId(event);
  const body = await readValidatedBody(event, bodySchema.parse);
  return updateOwnerSettings(ownerId, {
    messengerNames: body.messengerNames,
    tierConfig: body.tierConfig === undefined
      ? undefined
      : body.tierConfig && {
        ...body.tierConfig,
        labels: Object.fromEntries(Object.entries(body.tierConfig.labels).map(([k, v]) => [Number(k), v])),
      },
  });
});
