<script setup lang="ts">
useHead({ title: "Incoming offers" });

const { data, pending, refresh } = await useFetch("/api/mp/trades", { query: { view: "incoming" } });
</script>

<template>
  <MpPage
    id="incoming"
    title="Incoming offers"
    description="Offers detected in your imported Messenger conversations that still need your attention. Statuses are read from messages and are not decisions — you confirm those."
    wide
  >
    <template #actions>
      <UButton
        icon="i-lucide-refresh-cw"
        variant="outline"
        color="neutral"
        :loading="pending"
        @click="refresh()"
      >
        Refresh
      </UButton>
    </template>

    <MpHealthBanner class="mb-4" />

    <div
      v-if="data?.trades.length"
      class="space-y-3"
    >
      <MpTradeCard
        v-for="trade in data.trades"
        :key="trade.tradeId"
        :trade="trade"
        :catalog="data.catalog"
      />
    </div>
    <UEmpty
      v-else-if="!pending"
      icon="i-lucide-inbox"
      title="No incoming offers"
      description="Import a Messenger export to detect offers."
      :actions="[{ label: 'Import messages', to: '/import' }]"
    />
  </MpPage>
</template>
