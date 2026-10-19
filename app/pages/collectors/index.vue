<script setup lang="ts">
useHead({ title: "Collectors" });
const q = ref("");
const { data, pending } = await useFetch("/api/mp/collectors", { query: { q } });
</script>

<template>
  <MpPage
    id="collectors"
    title="Collectors"
    description="Everyone you've talked to in your imported Messenger conversations."
  >
    <UInput
      v-model="q"
      placeholder="Filter by name"
      icon="i-lucide-search"
      class="mb-4 w-full max-w-sm"
    />
    <div class="divide-y divide-default rounded-lg border border-default bg-default">
      <NuxtLink
        v-for="c in data?.collectors"
        :key="c.id"
        :to="`/collectors/${c.id}`"
        class="flex items-center gap-3 px-4 py-3 hover:bg-elevated/50"
      >
        <UAvatar
          :alt="c.displayName"
          size="sm"
        />
        <span class="min-w-0 flex-1 truncate text-sm font-medium text-highlighted">{{ c.displayName }}</span>
        <span class="text-xs text-muted">{{ c.messageCount }} msgs · {{ c.tradeCount }} trades<template v-if="c.openTradeCount"> · {{ c.openTradeCount }} open</template></span>
        <span class="hidden text-xs text-dimmed sm:inline">last {{ formatDate(c.lastMessageAt) }}</span>
      </NuxtLink>
      <p
        v-if="!data?.collectors.length && !pending"
        class="px-4 py-6 text-center text-sm text-muted"
      >
        No collectors yet.
      </p>
    </div>
  </MpPage>
</template>
