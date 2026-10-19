<script setup lang="ts">
import { MESSAGE_SOURCE_LABELS } from "#shared/miniprint/types";
import type { MessageSource } from "#shared/miniprint/types";

useHead({ title: "System health" });
const toast = useToast();
const { data, refresh } = await useFetch("/api/mp/health");
const running = ref(false);

async function runJobs() {
  running.value = true;
  try {
    const r = await $fetch<{ ran: number; succeeded: number; failed: number; continued: number }>("/api/mp/jobs/run", { method: "POST" });
    toast.add({ title: `Ran ${r.ran} job step(s)`, description: `${r.succeeded} done, ${r.continued} continuing, ${r.failed} failed.`, color: r.failed ? "warning" : "success" });
    await refresh();
  }
  finally {
    running.value = false;
  }
}

async function retry(jobId: string) {
  await $fetch(`/api/mp/jobs/${jobId}/retry`, { method: "POST" });
  await refresh();
}

const jobTable = computed(() => {
  const kinds: Record<string, Record<string, number>> = {};
  for (const j of data.value?.jobs ?? []) {
    (kinds[j.kind] ??= {})[j.status] = j.n;
  }
  return kinds;
});

function sourceLabel(s: string) {
  return MESSAGE_SOURCE_LABELS[s as MessageSource] ?? s;
}
</script>

<template>
  <MpPage
    id="health"
    title="System health"
    description="Where your message data came from, how current it is, and what is still being processed."
    wide
  >
    <template #actions>
      <UButton
        icon="i-lucide-play"
        :loading="running"
        @click="runJobs"
      >
        Run pending jobs
      </UButton>
    </template>

    <template v-if="data">
      <UAlert
        class="mb-6"
        color="neutral"
        variant="subtle"
        icon="i-lucide-unplug"
        title="No live Messenger source is connected"
        :description="data.liveSource.description"
      />

      <div class="mb-8 grid gap-3 sm:grid-cols-4">
        <div class="rounded-lg border border-default bg-default p-3">
          <p class="text-xs text-muted">
            Last successful import
          </p>
          <p class="text-sm font-medium text-highlighted">
            {{ formatDate(data.lastSuccessfulIngestionAt) }}
          </p>
        </div>
        <div class="rounded-lg border border-default bg-default p-3">
          <p class="text-xs text-muted">
            Messages stored
          </p>
          <p class="text-sm font-medium text-highlighted">
            {{ data.messages.total }}
          </p>
        </div>
        <div class="rounded-lg border border-default bg-default p-3">
          <p class="text-xs text-muted">
            Awaiting analysis
          </p>
          <p class="text-sm font-medium text-highlighted">
            {{ data.messages.pending }}
          </p>
        </div>
        <div class="rounded-lg border border-default bg-default p-3">
          <p class="text-xs text-muted">
            Known gaps
          </p>
          <p class="text-sm font-medium text-highlighted">
            {{ data.knownGaps.length }}
          </p>
        </div>
      </div>

      <section class="mb-8">
        <h2 class="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted">
          Sources
        </h2>
        <div class="divide-y divide-default rounded-lg border border-default bg-default text-sm">
          <div
            v-for="s in data.sources"
            :key="s.source"
            class="px-4 py-2"
          >
            <span class="font-medium">{{ sourceLabel(s.source) }}</span>
            <span class="ms-2 text-xs text-muted">imported {{ formatDate(s.lastSuccessAt) }} · newest message {{ formatDate(s.latestMessageAt) }}</span>
          </div>
          <p
            v-if="!data.sources.length"
            class="px-4 py-3 text-muted"
          >
            Nothing imported yet.
          </p>
        </div>
      </section>

      <section class="mb-8">
        <h2 class="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted">
          Known collection gaps
        </h2>
        <div class="divide-y divide-default rounded-lg border border-default bg-default text-sm">
          <div
            v-for="g in data.knownGaps"
            :key="g.id"
            class="px-4 py-2"
          >
            <UBadge
              color="warning"
              variant="outline"
              size="sm"
            >
              {{ g.kind.replace(/_/g, " ") }}
            </UBadge>
            <span class="ms-2">{{ g.description }}</span>
            <span
              v-if="g.gapStart"
              class="ms-2 text-xs text-muted"
            >{{ formatDate(g.gapStart) }} → {{ formatDate(g.gapEnd) }}</span>
          </div>
          <p
            v-if="!data.knownGaps.length"
            class="px-4 py-3 text-muted"
          >
            No gaps detected in what was imported. Messages after your newest import are, by definition, not here.
          </p>
        </div>
      </section>

      <section class="mb-8">
        <h2 class="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted">
          Background jobs
        </h2>
        <div class="overflow-x-auto rounded-lg border border-default bg-default">
          <table class="w-full text-sm">
            <thead class="text-left text-xs text-muted">
              <tr>
                <th class="px-3 py-2 font-medium">
                  Kind
                </th>
                <th
                  v-for="s in ['queued', 'running', 'succeeded', 'failed', 'dead']"
                  :key="s"
                  class="px-3 py-2 font-medium"
                >
                  {{ s }}
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-default">
              <tr
                v-for="(counts, kind) in jobTable"
                :key="kind"
              >
                <td class="px-3 py-2">
                  {{ String(kind).replace(/_/g, " ") }}
                </td>
                <td
                  v-for="s in ['queued', 'running', 'succeeded', 'failed', 'dead']"
                  :key="s"
                  class="px-3 py-2"
                  :class="(s === 'failed' || s === 'dead') && counts[s] ? 'text-error' : ''"
                >
                  {{ counts[s] ?? 0 }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="mb-8">
        <h2 class="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted">
          Processing errors
        </h2>
        <div class="divide-y divide-default rounded-lg border border-default bg-default text-sm">
          <div
            v-for="e in data.recentErrors"
            :key="e.id"
            class="flex flex-wrap items-center gap-2 px-4 py-2"
          >
            <UBadge
              color="error"
              variant="outline"
              size="sm"
            >
              {{ e.status }}
            </UBadge>
            <span class="font-medium">{{ e.kind.replace(/_/g, " ") }}</span>
            <span class="text-xs text-muted">attempt {{ e.attempts }} · {{ formatDate(e.updatedAt) }}</span>
            <span class="w-full text-xs text-toned">{{ e.lastError }}</span>
            <UButton
              size="xs"
              variant="ghost"
              @click="retry(e.id)"
            >
              Retry
            </UButton>
          </div>
          <p
            v-if="!data.recentErrors.length"
            class="px-4 py-3 text-muted"
          >
            No errors.
          </p>
        </div>
      </section>

      <section>
        <h2 class="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted">
          Recent imports
        </h2>
        <div class="divide-y divide-default rounded-lg border border-default bg-default text-sm">
          <div
            v-for="b in data.recentBatches"
            :key="b.id"
            class="px-4 py-2"
          >
            <span class="font-medium">{{ sourceLabel(b.source) }}</span>
            <UBadge
              class="ms-2"
              :color="b.status === 'succeeded' ? 'success' : b.status === 'failed' ? 'error' : 'neutral'"
              variant="subtle"
              size="sm"
            >
              {{ b.status }}
            </UBadge>
            <span class="ms-2 text-xs text-muted">
              {{ formatDate(b.startedAt) }} · {{ b.messagesInserted }} new, {{ b.duplicatesSkipped }} duplicates skipped
              <template v-if="b.earliestMessageAt"> · covers {{ formatDate(b.earliestMessageAt) }} – {{ formatDate(b.latestMessageAt) }}</template>
            </span>
            <details
              v-if="b.warnings.length"
              class="mt-1 text-xs text-muted"
            >
              <summary>{{ b.warnings.length }} warning(s)</summary>
              <ul class="list-disc ps-5">
                <li
                  v-for="(w, i) in b.warnings"
                  :key="i"
                >
                  {{ w }}
                </li>
              </ul>
            </details>
          </div>
        </div>
      </section>
    </template>
  </MpPage>
</template>
