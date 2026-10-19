<script setup lang="ts">
const route = useRoute();
const router = useRouter();
const toast = useToast();
const id = computed(() => String(route.params.id));
const { data } = await useFetch(() => `/api/mp/collectors/${id.value}`);
const { data: tradeData } = await useFetch("/api/mp/trades", { query: { view: "all", collectorId: id } });

useHead({ title: () => data.value?.collector.displayName ?? "Collector" });

const revisionsByTrade = computed(() => {
  const map: Record<string, NonNullable<typeof data.value>["revisions"]> = {};
  for (const r of data.value?.revisions ?? []) {
    (map[r.tradeId] ??= []).push(r);
  }
  return map;
});

async function deleteAll() {
  if (!confirm(`Delete ${data.value?.collector.displayName} and every message, trade and record involving them? This cannot be undone.`)) return;
  try {
    const r = await $fetch<{ messagesDeleted: number; tradesDeleted: number }>(`/api/mp/collectors/${id.value}`, { method: "DELETE" });
    toast.add({ title: `Deleted ${r.messagesDeleted} message(s) and ${r.tradesDeleted} trade(s)`, color: "success" });
    await router.push("/collectors");
  }
  catch (e) {
    toast.add({ title: "Delete failed", description: errorMessage(e), color: "error" });
  }
}

async function deleteConversation(conversationId: string) {
  if (!confirm("Delete this conversation, its messages, and trades derived from it?")) return;
  await $fetch(`/api/mp/conversations/${conversationId}`, { method: "DELETE" });
  await refreshNuxtData();
}
</script>

<template>
  <MpPage
    id="collector"
    :title="data?.collector.displayName ?? 'Collector'"
    description="Conversations, every offer and counteroffer, and preferences this collector stated in their own words."
    wide
  >
    <template #actions>
      <UButton
        color="error"
        variant="outline"
        icon="i-lucide-trash-2"
        @click="deleteAll"
      >
        Delete collector data
      </UButton>
    </template>

    <template v-if="data">
      <section class="mb-8">
        <h2 class="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted">
          Stated preferences
        </h2>
        <ul
          v-if="data.preferences.length"
          class="space-y-1 text-sm"
        >
          <li
            v-for="p in data.preferences"
            :key="p.id"
          >
            <UBadge
              variant="outline"
              size="sm"
            >
              {{ p.kind.replace(/_/g, " ") }}
            </UBadge>
            “{{ p.quote }}”
          </li>
        </ul>
        <p
          v-else
          class="text-sm text-muted"
        >
          No explicit preferences found in messages.
        </p>
      </section>

      <section class="mb-8">
        <h2 class="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted">
          Conversations
        </h2>
        <div class="divide-y divide-default rounded-lg border border-default bg-default">
          <div
            v-for="c in data.conversations"
            :key="c.id"
            class="flex flex-wrap items-center gap-3 px-4 py-3 text-sm"
          >
            <span class="font-medium text-highlighted">{{ c.title ?? "Untitled" }}</span>
            <UBadge
              v-if="c.isGroup"
              size="sm"
              variant="outline"
            >
              group
            </UBadge>
            <span class="text-xs text-muted">{{ c.messageCount }} messages · {{ formatDate(c.firstMessageAt) }} – {{ formatDate(c.lastMessageAt) }}</span>
            <span class="text-xs text-dimmed">{{ c.sourceKey.split(":")[0] }}</span>
            <UButton
              class="ms-auto"
              size="xs"
              variant="ghost"
              color="error"
              icon="i-lucide-trash-2"
              aria-label="Delete conversation"
              @click="deleteConversation(c.id)"
            />
          </div>
        </div>
      </section>

      <section>
        <h2 class="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted">
          Trades ({{ data.trades.length }})
        </h2>
        <div class="space-y-3">
          <div
            v-for="t in tradeData?.trades"
            :key="t.tradeId"
          >
            <MpTradeCard
              :trade="t"
              :catalog="tradeData!.catalog"
            />
            <p class="mt-1 ps-4 text-xs text-muted">
              {{ revisionsByTrade[t.tradeId]?.length ?? 0 }} revision(s):
              {{ (revisionsByTrade[t.tradeId] ?? []).map(r => r.kind.replace(/_/g, " ")).join(" → ") }}
            </p>
          </div>
        </div>
      </section>
    </template>
  </MpPage>
</template>
