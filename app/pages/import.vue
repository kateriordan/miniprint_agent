<script setup lang="ts">
import { MESSAGE_SOURCE_LABELS } from "#shared/miniprint/types";
import type { MessageSource } from "#shared/miniprint/types";
import type { ParsedExport } from "~/utils/messenger-import";
import { parseExportFiles, suggestOwnerNames, toUploadChunks } from "~/utils/messenger-import";

useHead({ title: "Import messages" });
const toast = useToast();

const { data: settings, refresh: refreshSettings } = await useFetch("/api/mp/settings");
const namesInput = ref("");
watch(settings, (s) => {
  if (s && !namesInput.value) namesInput.value = s.messengerNames.join(", ");
}, { immediate: true });

async function saveNames(names = namesInput.value.split(",").map(n => n.trim()).filter(Boolean)) {
  await $fetch("/api/mp/settings", { method: "PUT", body: { messengerNames: names } });
  namesInput.value = names.join(", ");
  await refreshSettings();
  toast.add({ title: "Saved", color: "success" });
}

// --- export import ----------------------------------------------------------

const fileInput = ref<HTMLInputElement | null>(null);
const parsing = ref(false);
const parsed = ref<ParsedExport | null>(null);
const importing = ref(false);
const progress = ref("");

const summary = computed(() => {
  if (!parsed.value) return [];
  const bySource = new Map<MessageSource, { conversations: number; messages: number; first: number; last: number }>();
  for (const c of parsed.value.conversations) {
    const s = bySource.get(c.source) ?? { conversations: 0, messages: 0, first: Infinity, last: 0 };
    s.conversations++;
    s.messages += c.messages.length;
    if (c.messages.length) {
      s.first = Math.min(s.first, c.messages[0]!.timestampMs);
      s.last = Math.max(s.last, c.messages.at(-1)!.timestampMs);
    }
    bySource.set(c.source, s);
  }
  return [...bySource.entries()].map(([source, s]) => ({ source, ...s }));
});
const suggestions = computed(() => (parsed.value ? suggestOwnerNames(parsed.value.conversations) : []));

async function onFiles(event: Event) {
  const files = [...((event.target as HTMLInputElement).files ?? [])];
  if (!files.length) return;
  parsing.value = true;
  parsed.value = null;
  try {
    parsed.value = await parseExportFiles(files);
    if (!parsed.value.conversations.length) {
      toast.add({ title: "No Messenger conversations found", description: "Choose the export .zip, or the message_N.json files inside it (JSON format).", color: "warning" });
    }
  }
  catch (e) {
    toast.add({ title: "Could not read the export", description: errorMessage(e), color: "error" });
  }
  finally {
    parsing.value = false;
    if (fileInput.value) fileInput.value.value = "";
  }
}

async function runImport() {
  if (!parsed.value) return;
  if (!settings.value?.messengerNames.length) {
    toast.add({ title: "Set your Messenger name first", color: "warning" });
    return;
  }
  importing.value = true;
  try {
    for (const { source } of summary.value) {
      const conversations = parsed.value.conversations.filter(c => c.source === source);
      const { batch } = await $fetch<{ batch: { id: string } }>("/api/mp/imports", { method: "POST", body: { source, label: `${conversations.length} conversations` } });
      const chunks = toUploadChunks(conversations);
      let inserted = 0;
      let dupes = 0;
      try {
        for (const [i, chunk] of chunks.entries()) {
          progress.value = `${MESSAGE_SOURCE_LABELS[source]}: ${i + 1}/${chunks.length}`;
          const r = await $fetch<{ inserted: number; duplicates: number }>(`/api/mp/imports/${batch.id}/conversations`, { method: "POST", body: { conversations: chunk } });
          inserted += r.inserted;
          dupes += r.duplicates;
        }
        await $fetch(`/api/mp/imports/${batch.id}/complete`, { method: "POST", body: { warnings: parsed.value.warnings.slice(0, 500) } });
        toast.add({ title: `Imported ${inserted} new message(s)`, description: `${dupes} duplicate(s) skipped. Analysis is queued.`, color: "success" });
      }
      catch (e) {
        await $fetch(`/api/mp/imports/${batch.id}/fail`, { method: "POST", body: { reason: errorMessage(e) } }).catch(() => {});
        throw e;
      }
    }
    parsed.value = null;
  }
  catch (e) {
    toast.add({ title: "Import failed", description: errorMessage(e), color: "error" });
  }
  finally {
    importing.value = false;
    progress.value = "";
  }
}

// --- manual entry ------------------------------------------------------------

const manual = reactive({ collectorName: "", fromOwner: false, sentAt: new Date().toISOString().slice(0, 16), text: "" });
const savingManual = ref(false);
async function saveManual() {
  savingManual.value = true;
  try {
    await $fetch("/api/mp/messages/manual", {
      method: "POST",
      body: { ...manual, sentAt: new Date(manual.sentAt).toISOString() },
    });
    manual.text = "";
    toast.add({ title: "Message added", description: "It will be analyzed with its conversation.", color: "success" });
  }
  catch (e) {
    toast.add({ title: "Could not add message", description: errorMessage(e), color: "error" });
  }
  finally {
    savingManual.value = false;
  }
}

// --- deletion ---------------------------------------------------------------

const deleteConfirm = ref("");
async function deleteAll() {
  try {
    await $fetch("/api/mp/messages", { method: "DELETE", body: { confirm: deleteConfirm.value } });
    deleteConfirm.value = "";
    toast.add({ title: "All message data deleted", color: "success" });
  }
  catch (e) {
    toast.add({ title: "Delete failed", description: errorMessage(e), color: "error" });
  }
}
</script>

<template>
  <MpPage
    id="import"
    title="Import messages"
    description="Meta has no supported API for reading a personal Messenger inbox, so messages come from data exports you download yourself. Exports are read in this browser; only message text and attachment names are uploaded — photos and videos stay on your device."
  >
    <div class="space-y-8">
      <SettingsSection
        title="Your Messenger name"
        description="The name(s) you appear under in exports, so your messages are told apart from collectors'. Separate several with commas."
      >
        <SettingsRow label="Name(s)">
          <div class="flex gap-2">
            <UInput
              v-model="namesInput"
              class="flex-1"
              placeholder="e.g. Kate Riordan"
            />
            <UButton @click="saveNames()">
              Save
            </UButton>
          </div>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection
        title="1. Download your data from Meta"
        description="Two separate downloads are needed to cover everything."
      >
        <SettingsRow
          label="Export your information (all non-encrypted chats)"
          description="Facebook → Settings → Accounts Center → Your information and permissions → Export your information. Choose Messages, format JSON, media quality Low (media is ignored here)."
        />
        <SettingsRow
          label="Encrypted chats (secure storage)"
          description="On a computer at messenger.com: profile photo → Privacy & safety → End-to-end encrypted chats → Message storage → Download secure storage data. Requires secure storage to have been on."
        />
      </SettingsSection>

      <SettingsSection
        title="2. Import"
        description="Choose the export .zip(s), or the JSON files inside. Re-importing overlapping exports is safe — duplicates are skipped."
      >
        <SettingsRow label="Export files">
          <input
            ref="fileInput"
            type="file"
            accept=".zip,.json,application/zip,application/json"
            multiple
            class="hidden"
            @change="onFiles"
          >
          <UButton
            icon="i-lucide-file-archive"
            variant="outline"
            color="neutral"
            :loading="parsing"
            @click="fileInput?.click()"
          >
            Choose files
          </UButton>
        </SettingsRow>

        <div
          v-if="parsed"
          class="space-y-3 px-4 py-3"
        >
          <div
            v-for="s in summary"
            :key="s.source"
            class="text-sm"
          >
            <p class="font-medium text-highlighted">
              {{ MESSAGE_SOURCE_LABELS[s.source] }}
            </p>
            <p class="text-xs text-muted">
              {{ s.conversations }} conversation(s), {{ s.messages }} message(s)
              <template v-if="s.messages">
                · {{ formatDate(new Date(s.first)) }} – {{ formatDate(new Date(s.last)) }}
              </template>
            </p>
          </div>
          <div
            v-if="suggestions.length && !settings?.messengerNames.length"
            class="text-sm"
          >
            <p class="text-xs text-muted">
              You appear to be:
            </p>
            <UButton
              v-for="n in suggestions"
              :key="n"
              size="xs"
              variant="outline"
              class="me-2 mt-1"
              @click="saveNames([n])"
            >
              {{ n }}
            </UButton>
          </div>
          <details
            v-if="parsed.warnings.length"
            class="text-xs text-muted"
          >
            <summary>{{ parsed.warnings.length }} warning(s)</summary>
            <ul class="list-disc ps-5">
              <li
                v-for="(w, i) in parsed.warnings.slice(0, 100)"
                :key="i"
              >
                {{ w }}
              </li>
            </ul>
          </details>
          <UButton
            :loading="importing"
            :disabled="!summary.length"
            icon="i-lucide-upload"
            @click="runImport"
          >
            Import {{ progress }}
          </UButton>
        </div>
      </SettingsSection>

      <SettingsSection
        title="Add a single message"
        description="For new messages between exports. Paste or type it; it joins that collector's conversation."
      >
        <div class="space-y-3 px-4 py-3">
          <div class="flex flex-wrap gap-3">
            <UFormField
              label="Collector"
              class="min-w-48 flex-1"
            >
              <UInput
                v-model="manual.collectorName"
                class="w-full"
                placeholder="Name as it appears in Messenger"
              />
            </UFormField>
            <UFormField label="Sent at">
              <UInput
                v-model="manual.sentAt"
                type="datetime-local"
              />
            </UFormField>
          </div>
          <UCheckbox
            v-model="manual.fromOwner"
            label="I sent this message"
          />
          <UTextarea
            v-model="manual.text"
            :rows="3"
            class="w-full"
            placeholder="Message text"
          />
          <UButton
            :loading="savingManual"
            :disabled="!manual.collectorName || !manual.text"
            @click="saveManual"
          >
            Add message
          </UButton>
        </div>
      </SettingsSection>

      <SettingsSection
        title="Delete message data"
        description="Deletes every imported message and everything derived from it: conversations, collectors, trades, revisions, evaluations, and evidence. Inventory and catalog are kept. Individual collectors or conversations can be deleted from the Collectors page."
      >
        <div class="flex flex-wrap gap-2 px-4 py-3">
          <UInput
            v-model="deleteConfirm"
            placeholder="Type DELETE ALL MESSAGES"
            class="min-w-64 flex-1"
          />
          <UButton
            color="error"
            :disabled="deleteConfirm !== 'DELETE ALL MESSAGES'"
            @click="deleteAll"
          >
            Delete
          </UButton>
        </div>
      </SettingsSection>
    </div>
  </MpPage>
</template>
