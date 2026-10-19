<script setup lang="ts">
useHead({ title: "Catalog verification" });
const toast = useToast();
const { data, refresh } = await useFetch("/api/mp/catalog/review");
const syncing = ref(false);
const verifying = ref<string | null>(null);

async function sync() {
  syncing.value = true;
  try {
    await $fetch("/api/mp/catalog/sync", { method: "POST" });
    toast.add({ title: "Catalog sync queued", description: "About 1,000 public pages are read at roughly one per second, so a full sync takes 20–25 minutes of job time.", color: "success" });
    await $fetch("/api/mp/jobs/run", { method: "POST" });
    await refresh();
  }
  finally {
    syncing.value = false;
  }
}

async function verify(printId: string) {
  verifying.value = printId;
  try {
    const r = await $fetch<{ ok: boolean; error?: string }>(`/api/mp/catalog/${printId}/verify`, { method: "POST" });
    toast.add({ title: r.ok ? "Re-verified" : "Could not verify", description: r.error, color: r.ok ? "success" : "warning" });
    await refresh();
  }
  finally {
    verifying.value = null;
  }
}
</script>

<template>
  <MpPage
    id="catalog"
    title="Catalog verification"
    description="MiniPrint.io is the only source of print names, artists, rarity and circulation status. It has no public API; this app reads its public print pages (allowed by its robots.txt), politely paced, and stores what each page says."
    wide
  >
    <template #actions>
      <UButton
        icon="i-lucide-refresh-cw"
        :loading="syncing"
        @click="sync"
      >
        Sync catalog
      </UButton>
    </template>

    <template v-if="data">
      <div class="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-6">
        <div
          v-for="[label, value] in ([
            ['Prints', data.counts?.total],
            ['Verified', data.counts?.verified],
            ['Rarity missing', data.counts?.rarityMissing],
            ['Gone from site', data.counts?.missingFromSource],
            ['Conflicts', data.counts?.conflict],
            ['Need refresh', data.counts?.stale],
          ] as const)"
          :key="label"
          class="rounded-lg border border-default bg-default p-3"
        >
          <p class="text-xs text-muted">
            {{ label }}
          </p>
          <p class="text-lg font-medium text-highlighted">
            {{ value ?? 0 }}
          </p>
        </div>
      </div>

      <section class="mb-8">
        <h2 class="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted">
          Prints in trades without a confirmed catalog match
        </h2>
        <div class="divide-y divide-default rounded-lg border border-default bg-default">
          <div
            v-for="(l, i) in data.unresolvedTradeLines"
            :key="i"
            class="flex flex-wrap items-center gap-2 px-4 py-2 text-sm"
          >
            <span>“{{ l.label }}”</span>
            <UBadge
              color="warning"
              variant="outline"
              size="sm"
            >
              {{ l.matchStatus }}
            </UBadge>
            <span class="text-xs text-muted">{{ l.collectorName }} · {{ statusLabel(l.status) }}</span>
            <UButton
              class="ms-auto"
              size="xs"
              variant="ghost"
              :to="`/trades/${l.tradeId}`"
            >
              Fix on trade
            </UButton>
          </div>
          <p
            v-if="!data.unresolvedTradeLines.length"
            class="px-4 py-3 text-sm text-muted"
          >
            None.
          </p>
        </div>
      </section>

      <section class="mb-8">
        <h2 class="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted">
          Photo identifications needing review
        </h2>
        <p class="text-sm text-muted">
          {{ data.detectionsNeedingReview.length }} ambiguous or unmatched identification(s).
          <NuxtLink
            to="/inventory"
            class="underline"
          >Review on the inventory page</NuxtLink>
        </p>
      </section>

      <section class="mb-8">
        <h2 class="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted">
          Catalog records needing attention
        </h2>
        <div class="divide-y divide-default rounded-lg border border-default bg-default">
          <div
            v-for="p in data.problems"
            :key="p.printId"
            class="flex flex-wrap items-center gap-2 px-4 py-2"
          >
            <MpPrintChip
              :label="p.canonicalName"
              :print="p"
            />
            <UBadge
              variant="outline"
              size="sm"
            >
              {{ p.verificationStatus.replace(/_/g, " ") }}
            </UBadge>
            <span class="text-xs text-muted">verified {{ formatDate(p.verifiedAt) }}</span>
            <UButton
              class="ms-auto"
              size="xs"
              variant="ghost"
              :loading="verifying === p.printId"
              @click="verify(p.printId)"
            >
              Re-verify
            </UButton>
          </div>
          <p
            v-if="!data.problems.length"
            class="px-4 py-3 text-sm text-muted"
          >
            None.
          </p>
        </div>
      </section>

      <section>
        <h2 class="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted">
          Recent sync runs
        </h2>
        <div class="divide-y divide-default rounded-lg border border-default bg-default text-sm">
          <div
            v-for="r in data.runs"
            :key="r.id"
            class="px-4 py-2"
          >
            <span class="font-medium">{{ r.status }}</span>
            <span class="ms-2 text-xs text-muted">started {{ formatDate(r.startedAt) }} · {{ r.pagesFetched }} pages · {{ r.printsUpserted }} verified · {{ r.printsMissing }} gone · {{ r.errors.length }} error(s)</span>
            <details
              v-if="r.errors.length"
              class="mt-1 text-xs text-muted"
            >
              <summary>Errors</summary>
              <ul class="list-disc ps-5">
                <li
                  v-for="(e, i) in r.errors.slice(0, 30)"
                  :key="i"
                >
                  {{ e }}
                </li>
              </ul>
            </details>
          </div>
          <p
            v-if="!data.runs.length"
            class="px-4 py-3 text-muted"
          >
            The catalog has never been synced. Click “Sync catalog”.
          </p>
        </div>
      </section>
    </template>
  </MpPage>
</template>
