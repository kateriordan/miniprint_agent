<script setup lang="ts">
useHead({ title: "Trade opportunities" });

const toast = useToast();
const { data, pending, refresh } = await useFetch("/api/mp/trades", { query: { view: "opportunities" } });
const evaluating = ref(false);
const progress = ref("");

async function evaluateAll() {
  if (!data.value) return;
  evaluating.value = true;
  try {
    const list = data.value.trades;
    for (const [i, t] of list.entries()) {
      progress.value = `${i + 1}/${list.length}`;
      await $fetch(`/api/mp/trades/${t.tradeId}/evaluate`, { method: "POST" }).catch((error) => {
        toast.add({ title: `Could not evaluate a trade with ${t.collectorName ?? "unknown"}`, description: errorMessage(error), color: "error" });
      });
    }
    await refresh();
  }
  finally {
    evaluating.value = false;
    progress.value = "";
  }
}
</script>

<template>
  <MpPage
    id="opportunities"
    title="Trade opportunities"
    description="Open offers ranked by the latest evaluation, verified catalog data, and whether you have documented the prints you'd give. Ranking uses your rarity ordering (common < limited < unicorn/OOC); it is not a valuation."
    wide
  >
    <template #actions>
      <UButton
        icon="i-lucide-scale"
        :loading="evaluating"
        @click="evaluateAll"
      >
        Evaluate all {{ progress }}
      </UButton>
    </template>

    <div
      v-if="data?.trades.length"
      class="space-y-3"
    >
      <MpTradeCard
        v-for="(trade, i) in data.trades"
        :key="trade.tradeId"
        :trade="trade"
        :catalog="data.catalog"
        :rank="i + 1"
      />
    </div>
    <UEmpty
      v-else-if="!pending"
      icon="i-lucide-sparkles"
      title="No open trades"
      description="Offers appear here once messages are imported and analyzed."
    />
  </MpPage>
</template>
