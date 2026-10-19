<script setup lang="ts">
import type { TradeLine, TradeRecommendation } from "#shared/miniprint/types";
import type { CatalogMap } from "~/composables/useMiniprint";

defineProps<{
  trade: {
    tradeId: string;
    collectorName: string | null;
    tradeStatus: string;
    statusSource: string;
    proposedStatus: string | null;
    printsRequested: TradeLine[];
    printsOffered: TradeLine[];
    firstSeenAt: string;
    lastUpdatedAt: string;
    recommendation: TradeRecommendation | null;
    rarityVerificationStatus: string;
    inventoryMatchStatus: string;
    sourceMessageIds: string[];
  };
  catalog: CatalogMap;
  rank?: number;
}>();
</script>

<template>
  <article class="rounded-lg border border-default bg-default p-4">
    <div class="mb-3 flex flex-wrap items-center gap-2">
      <span
        v-if="rank"
        class="text-sm font-medium text-muted"
      >#{{ rank }}</span>
      <NuxtLink
        :to="`/trades/${trade.tradeId}`"
        class="font-medium text-highlighted hover:underline"
      >
        {{ trade.collectorName ?? "Unknown collector" }}
      </NuxtLink>
      <UBadge
        :color="statusColor(trade.tradeStatus)"
        variant="subtle"
      >
        {{ statusLabel(trade.tradeStatus) }}
      </UBadge>
      <span
        v-if="trade.statusSource === 'ai_interpretation'"
        class="text-xs text-dimmed"
      >status inferred from messages</span>
      <span class="ms-auto text-xs text-muted">last activity {{ formatDate(trade.lastUpdatedAt) }}</span>
    </div>

    <UAlert
      v-if="trade.proposedStatus"
      class="mb-3"
      color="warning"
      variant="subtle"
      icon="i-lucide-circle-help"
      :title="`Messages suggest: ${statusLabel(trade.proposedStatus)}`"
      description="Not applied — confirm or dismiss it on the trade page."
    />

    <MpTradeLines
      :requested="trade.printsRequested"
      :offered="trade.printsOffered"
      :catalog="catalog"
    />

    <div class="mt-3 flex flex-wrap items-center gap-2 border-t border-default pt-3 text-xs text-muted">
      <template v-if="trade.recommendation">
        <UBadge
          color="primary"
          variant="soft"
          size="sm"
        >
          Suggested: {{ recommendationLabel(trade.recommendation.action) }}
        </UBadge>
        <span class="min-w-0 flex-1 truncate">{{ trade.recommendation.summary }}</span>
      </template>
      <span v-else>Not evaluated yet</span>
      <span>· rarity {{ trade.rarityVerificationStatus.replace(/_/g, " ") }}</span>
      <span>· inventory {{ trade.inventoryMatchStatus.replace(/_/g, " ") }}</span>
      <span>· {{ trade.sourceMessageIds.length }} source message(s)</span>
      <UButton
        :to="`/trades/${trade.tradeId}`"
        size="xs"
        variant="ghost"
        trailing-icon="i-lucide-arrow-right"
      >
        Evidence & timeline
      </UButton>
    </div>
  </article>
</template>
