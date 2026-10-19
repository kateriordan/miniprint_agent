<script setup lang="ts">
import { TRADE_STATUSES } from "#shared/miniprint/types";
import type { EvaluationFacts, EvidenceCategory, TradeLine, TradeStatus } from "#shared/miniprint/types";
import type { CatalogFact } from "~/composables/useMiniprint";

const route = useRoute();
const toast = useToast();
const id = computed(() => String(route.params.id));
const { data, refresh, error } = await useFetch(() => `/api/mp/trades/${id.value}`);

useHead({ title: () => `Trade with ${data.value?.collector?.displayName ?? "collector"}` });

const messagesById = computed(() => Object.fromEntries((data.value?.messages ?? []).map(m => [m.id, m])));
const latestEvaluation = computed(() => data.value?.evaluations[0] ?? null);
const facts = computed(() => latestEvaluation.value?.facts as EvaluationFacts | undefined);

const CATEGORY_LABELS: Record<EvidenceCategory, string> = {
  verified_catalog_fact: "Verified catalog facts (MiniPrint.io)",
  stated_preference: "What the collector explicitly said",
  message_fact: "Facts from messages and your records",
  ai_interpretation: "AI interpretation",
  unknown: "Unknown or unverified",
};
const evidenceGroups = computed(() => {
  const groups: Partial<Record<EvidenceCategory, EvaluationFacts["evidence"]>> = {};
  for (const e of facts.value?.evidence ?? []) {
    (groups[e.category] ??= []).push(e);
  }
  return (Object.keys(CATEGORY_LABELS) as EvidenceCategory[])
    .filter(k => groups[k]?.length)
    .map(k => ({ key: k, label: CATEGORY_LABELS[k], items: groups[k]! }));
});

// --- actions -------------------------------------------------------------

const evaluating = ref(false);
async function evaluate() {
  evaluating.value = true;
  try {
    await $fetch(`/api/mp/trades/${id.value}/evaluate`, { method: "POST" });
    await refresh();
  }
  catch (e) {
    toast.add({ title: "Evaluation failed", description: errorMessage(e), color: "error" });
  }
  finally {
    evaluating.value = false;
  }
}

const statusForm = reactive<{ status: TradeStatus | undefined; notes: string; applyInventory: boolean }>({ status: undefined, notes: "", applyInventory: false });
watch(data, (d) => {
  if (d && !statusForm.status) statusForm.status = d.trade.tradeStatus as TradeStatus;
}, { immediate: true });
const statusItems = TRADE_STATUSES.map(s => ({ label: statusLabel(s), value: s }));
const confirmOpen = ref(false);
const saving = ref(false);

async function saveStatus(status: string | undefined = statusForm.status) {
  if (!status) return;
  saving.value = true;
  try {
    const res = await $fetch<{ inventoryChanges: string[] }>(`/api/mp/trades/${id.value}/status`, {
      method: "POST",
      body: { status, notes: statusForm.notes || null, applyInventory: status === "completed" && statusForm.applyInventory },
    });
    toast.add({
      title: `Status set to ${statusLabel(status)}`,
      description: res.inventoryChanges.length ? res.inventoryChanges.join(" ") : undefined,
      color: "success",
    });
    confirmOpen.value = false;
    statusForm.notes = "";
    await refresh();
  }
  catch (e) {
    toast.add({ title: "Could not update status", description: errorMessage(e), color: "error" });
  }
  finally {
    saving.value = false;
  }
}

// Correcting print identifications.
const editOpen = ref(false);
const editLines = reactive<{ requested: Array<{ label: string; quantity: number | null; printId: string | null }>; offered: Array<{ label: string; quantity: number | null; printId: string | null }> }>({ requested: [], offered: [] });
const picking = ref<{ side: "requested" | "offered"; index: number } | null>(null);

function openEditor() {
  if (!data.value) return;
  const map = (l: TradeLine) => ({ label: l.label, quantity: l.quantity, printId: l.printId });
  editLines.requested = data.value.trade.printsRequested.map(map);
  editLines.offered = data.value.trade.printsOffered.map(map);
  editOpen.value = true;
}
function pick(print: CatalogFact) {
  if (!picking.value) return;
  const line = editLines[picking.value.side][picking.value.index]!;
  line.printId = print.printId;
  picking.value = null;
}
async function saveLines() {
  saving.value = true;
  try {
    await $fetch(`/api/mp/trades/${id.value}/lines`, {
      method: "POST",
      body: { printsRequested: editLines.requested, printsOffered: editLines.offered },
    });
    editOpen.value = false;
    await refresh();
  }
  catch (e) {
    toast.add({ title: "Could not save prints", description: errorMessage(e), color: "error" });
  }
  finally {
    saving.value = false;
  }
}

// Conversation context for a message.
const contextOpen = ref(false);
const contextMessages = ref<Array<{ id: string; senderName: string; senderIsOwner: boolean; sentAt: string; text: string | null }>>([]);
const contextAnchor = ref("");
async function showContext(messageId: string) {
  contextAnchor.value = messageId;
  const res = await $fetch<{ messages: typeof contextMessages.value }>("/api/mp/messages", { query: { around: messageId } });
  contextMessages.value = res.messages;
  contextOpen.value = true;
}

function refLabel(ref: { type: string; id: string }) {
  if (ref.type === "message") {
    const m = messagesById.value[ref.id];
    return m ? `${m.senderName}, ${formatDate(m.sentAt)}` : "message";
  }
  if (ref.type === "catalog_record") return "MiniPrint.io";
  if (ref.type === "trade") return `trade ${ref.id.slice(0, 8)}`;
  if (ref.type === "inventory_item") return "inventory";
  return ref.type;
}
</script>

<template>
  <MpPage
    id="trade"
    :title="data ? `Trade with ${data.collector?.displayName ?? 'unknown collector'}` : 'Trade'"
    description="How this offer evolved, the messages behind it, and the evidence for any recommendation."
    wide
  >
    <UAlert
      v-if="error"
      color="error"
      :title="errorMessage(error)"
    />
    <template v-if="data">
      <div class="mb-6 flex flex-wrap items-center gap-2">
        <UBadge
          :color="statusColor(data.trade.tradeStatus)"
          variant="subtle"
          size="lg"
        >
          {{ statusLabel(data.trade.tradeStatus) }}
        </UBadge>
        <span class="text-xs text-muted">
          {{ data.trade.statusSource === "owner_confirmed" ? "set by you" : "inferred from messages — not a decision" }}
          · first seen {{ formatDate(data.trade.firstSeenAt) }} · last activity {{ formatDate(data.trade.lastUpdatedAt) }}
        </span>
        <UButton
          v-if="data.collector"
          :to="`/collectors/${data.collector.id}`"
          size="xs"
          variant="ghost"
          icon="i-lucide-user-round"
        >
          Collector history
        </UButton>
      </div>

      <UAlert
        v-if="data.trade.proposedStatus"
        class="mb-6"
        color="warning"
        variant="subtle"
        icon="i-lucide-circle-help"
        :title="`The messages suggest this trade is ${statusLabel(data.trade.proposedStatus).toLowerCase()}`"
        description="This was detected by AI from the messages below and has not been applied."
        :actions="[
          { label: `Confirm ${statusLabel(data.trade.proposedStatus)}`, color: 'warning', onClick: () => { statusForm.status = data!.trade.proposedStatus! as TradeStatus; confirmOpen = true; } },
          { label: 'Dismiss', variant: 'ghost', color: 'neutral', onClick: () => saveStatus(data!.trade.tradeStatus) },
        ]"
      />

      <section class="mb-8 rounded-lg border border-default bg-default p-4">
        <div class="mb-3 flex items-center justify-between">
          <h2 class="text-sm font-medium text-highlighted">
            Current terms
          </h2>
          <UButton
            size="xs"
            variant="outline"
            color="neutral"
            icon="i-lucide-pencil"
            @click="openEditor"
          >
            Correct prints
          </UButton>
        </div>
        <MpTradeLines
          :requested="data.trade.printsRequested"
          :offered="data.trade.printsOffered"
          :catalog="data.catalog"
        />
      </section>

      <section class="mb-8 rounded-lg border border-default bg-default p-4">
        <div class="mb-3 flex items-center justify-between gap-2">
          <h2 class="text-sm font-medium text-highlighted">
            Recommendation
          </h2>
          <UButton
            size="xs"
            icon="i-lucide-scale"
            :loading="evaluating"
            @click="evaluate"
          >
            {{ latestEvaluation ? "Re-evaluate" : "Evaluate" }}
          </UButton>
        </div>
        <template v-if="latestEvaluation && facts">
          <p class="mb-1 text-sm">
            <UBadge
              color="primary"
              variant="soft"
            >
              Suggested: {{ recommendationLabel(latestEvaluation.recommendation) }}
            </UBadge>
            <span class="ms-2 text-toned">{{ latestEvaluation.summary }}</span>
          </p>
          <p class="mb-4 text-xs text-dimmed">
            AI-assisted recommendation from revision {{ latestEvaluation.tradeRevision }} · catalog re-checked {{ formatDate(facts.catalogCheckedAt) }}.
            <template v-if="latestEvaluation.tradeRevision !== data.trade.currentRevision">
              <strong>The trade has changed since — re-evaluate.</strong>
            </template>
          </p>

          <div class="space-y-4">
            <div
              v-for="group in evidenceGroups"
              :key="group.key"
            >
              <p class="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted">
                {{ group.label }}
              </p>
              <ul class="space-y-1 text-sm">
                <li
                  v-for="(e, i) in group.items"
                  :key="i"
                >
                  {{ e.statement }}
                  <template
                    v-for="r in e.refs"
                    :key="r.id"
                  >
                    <a
                      v-if="r.url"
                      :href="r.url"
                      target="_blank"
                      rel="noopener noreferrer"
                      class="ms-1 text-xs text-primary underline"
                    >{{ refLabel(r) }}</a>
                    <button
                      v-else-if="r.type === 'message'"
                      class="ms-1 text-xs text-primary underline"
                      @click="showContext(r.id)"
                    >
                      {{ refLabel(r) }}
                    </button>
                    <NuxtLink
                      v-else-if="r.type === 'trade'"
                      :to="`/trades/${r.id}`"
                      class="ms-1 text-xs text-primary underline"
                    >{{ refLabel(r) }}</NuxtLink>
                    <NuxtLink
                      v-else-if="r.type === 'inventory_item'"
                      to="/inventory"
                      class="ms-1 text-xs text-primary underline"
                    >{{ refLabel(r) }}</NuxtLink>
                  </template>
                </li>
              </ul>
            </div>
            <div v-if="facts.uncertainties.length">
              <p class="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted">
                Uncertainties
              </p>
              <ul class="list-disc space-y-1 ps-5 text-sm text-toned">
                <li
                  v-for="(u, i) in facts.uncertainties"
                  :key="i"
                >
                  {{ u }}
                </li>
              </ul>
            </div>
            <div v-if="facts.missingInformation.length">
              <p class="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted">
                Missing information
              </p>
              <ul class="list-disc space-y-1 ps-5 text-sm text-toned">
                <li
                  v-for="(u, i) in facts.missingInformation"
                  :key="i"
                >
                  {{ u }}
                </li>
              </ul>
            </div>
          </div>
        </template>
        <p
          v-else
          class="text-sm text-muted"
        >
          Not evaluated yet. Evaluating re-checks each print on MiniPrint.io, your inventory, and other open trades.
        </p>
      </section>

      <section class="mb-8 rounded-lg border border-default bg-default p-4">
        <h2 class="mb-1 text-sm font-medium text-highlighted">
          Your decision
        </h2>
        <p class="mb-3 text-xs text-muted">
          Only you set accepted, completed, declined, cancelled or expired. Nothing is sent to the collector.
        </p>
        <div class="flex flex-wrap items-end gap-3">
          <UFormField label="Status">
            <USelect
              v-model="statusForm.status"
              :items="statusItems"
              class="w-48"
            />
          </UFormField>
          <UFormField
            label="Notes"
            class="min-w-60 flex-1"
          >
            <UInput
              v-model="statusForm.notes"
              placeholder="Optional"
              class="w-full"
            />
          </UFormField>
          <UButton
            :disabled="statusForm.status === data.trade.tradeStatus && !statusForm.notes"
            @click="confirmOpen = true"
          >
            Save status
          </UButton>
        </div>
        <UCheckbox
          v-if="statusForm.status === 'completed'"
          v-model="statusForm.applyInventory"
          class="mt-3"
          label="Also update my inventory: reduce quantities of the prints I gave"
        />
      </section>

      <section>
        <h2 class="mb-3 text-sm font-medium text-highlighted">
          Timeline
        </h2>
        <ol class="relative space-y-4 border-s border-default ps-5">
          <li
            v-for="rev in data.revisions"
            :key="rev.id"
          >
            <span class="absolute -start-1.5 mt-1.5 size-3 rounded-full border border-default bg-default" />
            <div class="mb-1 flex flex-wrap items-center gap-2 text-sm">
              <span class="font-medium text-highlighted">Revision {{ rev.revision }} · {{ rev.kind.replace(/_/g, " ") }}</span>
              <UBadge
                :color="statusColor(rev.tradeStatus)"
                variant="subtle"
                size="sm"
              >
                {{ statusLabel(rev.tradeStatus) }}
              </UBadge>
              <UBadge
                :color="rev.recordedBy === 'owner' ? 'success' : 'neutral'"
                variant="outline"
                size="sm"
              >
                {{ rev.recordedBy === "owner" ? "by you" : `AI interpretation${rev.confidence ? ` · ${rev.confidence} confidence` : ""}` }}
              </UBadge>
              <span class="text-xs text-muted">{{ formatDate(rev.createdAt) }}</span>
            </div>
            <p
              v-if="rev.interpretation"
              class="text-sm text-toned"
            >
              {{ rev.interpretation }}
            </p>
            <p
              v-if="rev.quote"
              class="mt-1 text-xs text-muted"
            >
              Quote: “{{ rev.quote }}”
              <UBadge
                :color="rev.quoteVerified ? 'success' : 'error'"
                variant="outline"
                size="sm"
              >
                {{ rev.quoteVerified ? "found in message" : "not found in message" }}
              </UBadge>
            </p>
            <div class="mt-2">
              <MpTradeLines
                :requested="rev.printsRequested"
                :offered="rev.printsOffered"
                :catalog="data.catalog"
              />
            </div>
            <ul
              v-if="rev.sourceMessageIds.length"
              class="mt-2 space-y-1"
            >
              <li
                v-for="mid in rev.sourceMessageIds"
                :key="mid"
                class="rounded-md bg-elevated/60 px-3 py-2 text-sm"
              >
                <template v-if="messagesById[mid]">
                  <p class="text-xs text-muted">
                    {{ messagesById[mid].senderName }}{{ messagesById[mid].senderIsOwner ? " (you)" : "" }} · {{ formatDate(messagesById[mid].sentAt) }}
                    <button
                      class="ms-2 underline"
                      @click="showContext(mid)"
                    >
                      context
                    </button>
                  </p>
                  <p class="whitespace-pre-wrap">
                    {{ messagesById[mid].text || "(no text)" }}
                  </p>
                  <p
                    v-if="messagesById[mid].attachments.length"
                    class="text-xs text-dimmed"
                  >
                    {{ messagesById[mid].attachments.length }} attachment(s) — not imported
                  </p>
                </template>
                <span
                  v-else
                  class="text-xs text-dimmed"
                >Message {{ mid.slice(0, 8) }} was deleted</span>
              </li>
            </ul>
          </li>
        </ol>
      </section>
    </template>

    <UModal
      v-model:open="confirmOpen"
      :title="`Set status to ${statusLabel(statusForm.status ?? '')}?`"
      description="This records your decision in the trade ledger. It does not message the collector."
    >
      <template #footer>
        <UButton
          variant="ghost"
          color="neutral"
          @click="confirmOpen = false"
        >
          Cancel
        </UButton>
        <UButton
          :loading="saving"
          @click="saveStatus()"
        >
          Confirm
        </UButton>
      </template>
    </UModal>

    <UModal
      v-model:open="editOpen"
      title="Correct prints"
      description="Fix names, quantities, or catalog matches. The original offer stays in the timeline."
      :ui="{ content: 'max-w-3xl' }"
    >
      <template #body>
        <div class="space-y-6">
          <div
            v-for="side in (['requested', 'offered'] as const)"
            :key="side"
          >
            <p class="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted">
              {{ side === "requested" ? "You would give" : "You would receive" }}
            </p>
            <div
              v-for="(line, i) in editLines[side]"
              :key="i"
              class="mb-2 flex flex-wrap items-center gap-2"
            >
              <UInput
                v-model="line.label"
                class="min-w-40 flex-1"
              />
              <UInputNumber
                v-model="line.quantity as number"
                :min="1"
                placeholder="qty"
                class="w-28"
              />
              <UBadge
                :color="line.printId ? 'success' : 'warning'"
                variant="outline"
              >
                {{ line.printId ? (data?.catalog[line.printId]?.canonicalName ?? line.printId) : "no catalog match" }}
              </UBadge>
              <UButton
                size="xs"
                variant="outline"
                color="neutral"
                @click="picking = { side, index: i }"
              >
                Match
              </UButton>
              <UButton
                size="xs"
                variant="ghost"
                color="error"
                icon="i-lucide-x"
                aria-label="Remove"
                @click="editLines[side].splice(i, 1)"
              />
            </div>
            <UButton
              size="xs"
              variant="ghost"
              icon="i-lucide-plus"
              @click="editLines[side].push({ label: '', quantity: null, printId: null })"
            >
              Add print
            </UButton>
          </div>
          <div
            v-if="picking"
            class="rounded-md border border-default p-3"
          >
            <MpCatalogPicker
              :initial-query="editLines[picking.side][picking.index]?.label"
              @pick="pick"
            />
          </div>
        </div>
      </template>
      <template #footer>
        <UButton
          variant="ghost"
          color="neutral"
          @click="editOpen = false"
        >
          Cancel
        </UButton>
        <UButton
          :loading="saving"
          @click="saveLines"
        >
          Save correction
        </UButton>
      </template>
    </UModal>

    <UModal
      v-model:open="contextOpen"
      title="Conversation context"
      :ui="{ content: 'max-w-2xl' }"
    >
      <template #body>
        <ul class="space-y-2">
          <li
            v-for="m in contextMessages"
            :key="m.id"
            class="rounded-md px-3 py-2 text-sm"
            :class="m.id === contextAnchor ? 'bg-primary/10 ring ring-primary/30' : 'bg-elevated/60'"
          >
            <p class="text-xs text-muted">
              {{ m.senderName }}{{ m.senderIsOwner ? " (you)" : "" }} · {{ formatDate(m.sentAt) }}
            </p>
            <p class="whitespace-pre-wrap">
              {{ m.text || "(no text)" }}
            </p>
          </li>
        </ul>
      </template>
    </UModal>
  </MpPage>
</template>
