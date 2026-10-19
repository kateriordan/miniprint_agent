<script setup lang="ts">
import type { CatalogFact } from "~/composables/useMiniprint";

useHead({ title: "My inventory" });

const toast = useToast();
const { data, refresh, pending } = await useFetch("/api/mp/inventory");

const detectionsByUpload = computed(() => {
  const map: Record<string, NonNullable<typeof data.value>["detections"]> = {};
  for (const d of data.value?.detections ?? []) {
    (map[d.uploadId] ??= []).push(d);
  }
  return map;
});
const reviewCount = computed(() => (data.value?.detections ?? []).filter(d => d.reviewStatus === "needs_review").length);

// --- upload -------------------------------------------------------------

const uploading = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);

/** Downscale in the browser: smaller uploads, and enough detail to identify prints. */
async function prepare(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(b => (b ? resolve(b) : reject(new Error("encode failed"))), "image/jpeg", 0.9));
  }
  catch {
    return file;
  }
}

async function onFiles(event: Event) {
  const files = [...((event.target as HTMLInputElement).files ?? [])];
  if (!files.length) return;
  uploading.value = true;
  try {
    const form = new FormData();
    for (const f of files) {
      const blob = await prepare(f);
      const name = blob === f ? f.name : f.name.replace(/\.[^.]+$/, "") + ".jpg";
      form.append("photos", blob, name);
    }
    const res = await $fetch<{ results: Array<{ filename: string; duplicate: boolean; error: string | null }> }>("/api/mp/uploads", { method: "POST", body: form });
    const failed = res.results.filter(r => r.error);
    const dupes = res.results.filter(r => r.duplicate);
    toast.add({
      title: `${res.results.length - failed.length} photo(s) uploaded`,
      description: [
        dupes.length ? `${dupes.length} already uploaded before.` : "",
        ...failed.map(f => `${f.filename}: ${f.error}`),
      ].filter(Boolean).join(" ") || "Identification is queued.",
      color: failed.length ? "warning" : "success",
    });
    await refresh();
  }
  catch (e) {
    toast.add({ title: "Upload failed", description: errorMessage(e), color: "error" });
  }
  finally {
    uploading.value = false;
    if (fileInput.value) fileInput.value.value = "";
  }
}

const running = ref(false);
async function runJobs() {
  running.value = true;
  try {
    const r = await $fetch<{ ran: number; succeeded: number; failed: number }>("/api/mp/jobs/run", { method: "POST" });
    toast.add({ title: `Processed ${r.ran} job(s)`, description: r.failed ? `${r.failed} failed — see System health.` : undefined, color: r.failed ? "warning" : "success" });
    await refresh();
  }
  finally {
    running.value = false;
  }
}

async function retry(uploadId: string) {
  await $fetch(`/api/mp/uploads/${uploadId}/retry`, { method: "POST" });
  await refresh();
}

async function removeUpload(uploadId: string) {
  if (!confirm("Delete this photo and its identifications? Inventory items that only this photo supports will be removed.")) return;
  await $fetch(`/api/mp/uploads/${uploadId}`, { method: "DELETE" });
  await refresh();
}

// --- review -------------------------------------------------------------

const pickingFor = ref<string | null>(null);

async function review(detectionId: string, body: { action: "confirm" | "reject" | "correct"; printId?: string | null; visibleCount?: number | null }) {
  try {
    await $fetch(`/api/mp/detections/${detectionId}/review`, { method: "POST", body });
    pickingFor.value = null;
    await refresh();
  }
  catch (e) {
    toast.add({ title: "Could not save review", description: errorMessage(e), color: "error" });
  }
}

function onPick(detectionId: string, print: CatalogFact) {
  review(detectionId, { action: "correct", printId: print.printId });
}

// --- items --------------------------------------------------------------

const availabilityItems = [
  { label: "Available", value: "available" },
  { label: "Traded away", value: "traded_away" },
  { label: "Removed", value: "removed" },
];

async function updateItem(itemId: string, body: Record<string, unknown>) {
  try {
    await $fetch(`/api/mp/inventory/${itemId}`, { method: "PATCH", body });
    await refresh();
  }
  catch (e) {
    toast.add({ title: "Could not update", description: errorMessage(e), color: "error" });
  }
}

const addOpen = ref(false);
async function addManual(print: CatalogFact) {
  await $fetch("/api/mp/inventory", { method: "POST", body: { printId: print.printId, quantity: null } });
  addOpen.value = false;
  await refresh();
}

function basisLabel(basis: string, quantity: number | null) {
  if (quantity === null) return "quantity unknown";
  return ({
    photo_min_visible: "at least this many visible in one photo",
    owner_entered: "entered by you",
    owner_confirmed_trade: "after a trade you confirmed",
  } as Record<string, string>)[basis] ?? basis;
}

const enlarged = ref<string | null>(null);
</script>

<template>
  <MpPage
    id="inventory"
    title="My inventory"
    description="Prints identified from your trade-post photos and matched to MiniPrint.io. This documents what's in your photos — not everything you own. Nothing is removed because of an offer; availability changes only when you confirm a trade or edit it here."
    wide
  >
    <template #actions>
      <input
        ref="fileInput"
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
        multiple
        class="hidden"
        @change="onFiles"
      >
      <UButton
        icon="i-lucide-image-up"
        :loading="uploading"
        @click="fileInput?.click()"
      >
        Upload photos
      </UButton>
      <UButton
        icon="i-lucide-play"
        variant="outline"
        color="neutral"
        :loading="running"
        @click="runJobs"
      >
        Process now
      </UButton>
      <UButton
        icon="i-lucide-plus"
        variant="outline"
        color="neutral"
        @click="addOpen = true"
      >
        Add manually
      </UButton>
    </template>

    <UAlert
      v-if="reviewCount"
      class="mb-6"
      color="warning"
      variant="subtle"
      icon="i-lucide-scan-search"
      :title="`${reviewCount} identification(s) need your review`"
      description="Uncertain matches are never added to your inventory until you confirm them."
    />

    <section class="mb-10">
      <h2 class="mb-3 text-[10px] font-medium uppercase tracking-wider text-muted">
        Inventory ({{ data?.items.length ?? 0 }} prints)
      </h2>
      <div class="overflow-x-auto rounded-lg border border-default">
        <table class="w-full text-sm">
          <thead class="bg-elevated/50 text-left text-xs text-muted">
            <tr>
              <th class="px-3 py-2 font-medium">
                Print (MiniPrint.io)
              </th>
              <th class="px-3 py-2 font-medium">
                Quantity
              </th>
              <th class="px-3 py-2 font-medium">
                Availability
              </th>
              <th class="px-3 py-2 font-medium">
                Notes
              </th>
            </tr>
          </thead>
          <tbody class="divide-y divide-default">
            <tr
              v-for="item in data?.items"
              :key="item.id"
            >
              <td class="px-3 py-2">
                <MpPrintChip
                  :label="item.print.canonicalName"
                  :print="item.print"
                />
              </td>
              <td class="px-3 py-2">
                <UInputNumber
                  :model-value="item.quantity ?? undefined"
                  :min="0"
                  placeholder="?"
                  class="w-24"
                  @update:model-value="(v: number | null) => updateItem(item.id, { quantity: v ?? null })"
                />
                <p class="mt-0.5 text-xs text-dimmed">
                  {{ basisLabel(item.quantityBasis, item.quantity) }}
                </p>
              </td>
              <td class="px-3 py-2">
                <USelect
                  :model-value="item.availability"
                  :items="availabilityItems"
                  class="w-36"
                  @update:model-value="(v: string) => updateItem(item.id, { availability: v })"
                />
              </td>
              <td class="whitespace-pre-wrap px-3 py-2 text-xs text-muted">
                {{ item.notes }}
              </td>
            </tr>
            <tr v-if="!data?.items.length && !pending">
              <td
                colspan="4"
                class="px-3 py-6 text-center text-sm text-muted"
              >
                No confirmed prints yet. Upload your trade-post photos to start.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section>
      <h2 class="mb-3 text-[10px] font-medium uppercase tracking-wider text-muted">
        Photos and identifications
      </h2>
      <div class="space-y-6">
        <article
          v-for="upload in data?.uploads"
          :key="upload.id"
          class="rounded-lg border border-default bg-default p-4"
        >
          <div class="mb-3 flex flex-wrap items-center gap-3">
            <img
              :src="`/api/mp/uploads/${upload.id}/image`"
              :alt="upload.filename"
              class="h-20 w-28 cursor-zoom-in rounded object-cover"
              @click="enlarged = upload.id"
            >
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-medium text-highlighted">
                {{ upload.filename }}
              </p>
              <p class="text-xs text-muted">
                Uploaded {{ formatDate(upload.createdAt) }}
                <template v-if="upload.processedAt">
                  · identified {{ formatDate(upload.processedAt) }} with {{ upload.modelId }}
                </template>
              </p>
              <p
                v-if="upload.error"
                class="text-xs text-error"
              >
                {{ upload.error }}
              </p>
            </div>
            <UBadge
              :color="upload.status === 'done' ? 'success' : upload.status === 'failed' ? 'error' : 'neutral'"
              variant="subtle"
            >
              {{ upload.status }}
            </UBadge>
            <UButton
              v-if="upload.status !== 'processing'"
              size="xs"
              variant="ghost"
              icon="i-lucide-rotate-cw"
              @click="retry(upload.id)"
            >
              Re-identify
            </UButton>
            <UButton
              size="xs"
              variant="ghost"
              color="error"
              icon="i-lucide-trash-2"
              aria-label="Delete photo"
              @click="removeUpload(upload.id)"
            />
          </div>

          <ul class="divide-y divide-default rounded-md border border-default">
            <li
              v-for="d in detectionsByUpload[upload.id]"
              :key="d.id"
              class="px-3 py-3"
              :class="d.reviewStatus === 'needs_review' ? 'bg-warning/5' : ''"
            >
              <div class="flex flex-wrap items-start gap-2">
                <div class="min-w-0 flex-1">
                  <p class="text-sm">
                    <span class="text-muted">{{ d.locationHint }}:</span>
                    <MpPrintChip
                      v-if="d.matchedPrintId && d.reviewStatus !== 'rejected'"
                      class="ms-1"
                      :label="d.observedText ?? ''"
                      :print="data?.catalog[d.matchedPrintId]"
                    />
                    <span
                      v-else
                      class="ms-1 text-toned"
                    >{{ d.visualDescription }}</span>
                  </p>
                  <p class="mt-0.5 text-xs text-muted">
                    <template v-if="d.observedText">
                      Text read: “{{ d.observedText }}” ·
                    </template>
                    {{ d.visibleCount ? `${d.visibleCount} visible${d.countCertain ? "" : " (count uncertain)"}` : "count unknown" }}
                    · match {{ d.matchConfidence.replace(/_/g, " ") }}
                  </p>
                  <p
                    v-if="d.reviewNotes"
                    class="mt-0.5 text-xs text-warning"
                  >
                    {{ d.reviewNotes }}
                  </p>
                </div>
                <UBadge
                  :color="d.reviewStatus === 'needs_review' ? 'warning' : d.reviewStatus === 'rejected' ? 'neutral' : 'success'"
                  variant="outline"
                >
                  {{ d.reviewStatus.replace(/_/g, " ") }}
                </UBadge>
              </div>

              <div
                v-if="d.candidates.length && d.reviewStatus === 'needs_review'"
                class="mt-2 space-y-1"
              >
                <p class="text-[10px] font-medium uppercase tracking-wider text-muted">
                  Candidates
                </p>
                <div
                  v-for="c in d.candidates"
                  :key="c.printId"
                  class="flex flex-wrap items-center gap-2"
                >
                  <img
                    v-if="data?.catalog[c.printId]?.imageUrl"
                    :src="data.catalog[c.printId]!.imageUrl!"
                    alt=""
                    class="size-10 rounded object-cover"
                    referrerpolicy="no-referrer"
                    loading="lazy"
                  >
                  <MpPrintChip
                    :label="c.printId"
                    :print="data?.catalog[c.printId]"
                  />
                  <span
                    v-if="c.visualCheck"
                    class="text-xs text-muted"
                  >visual check — {{ c.visualCheck }}</span>
                  <UButton
                    size="xs"
                    variant="outline"
                    @click="review(d.id, { action: 'confirm', printId: c.printId })"
                  >
                    This one
                  </UButton>
                </div>
              </div>

              <div class="mt-2 flex flex-wrap gap-2">
                <UButton
                  v-if="d.reviewStatus === 'needs_review' && d.matchedPrintId"
                  size="xs"
                  @click="review(d.id, { action: 'confirm' })"
                >
                  Confirm match
                </UButton>
                <UButton
                  size="xs"
                  variant="outline"
                  color="neutral"
                  @click="pickingFor = pickingFor === d.id ? null : d.id"
                >
                  {{ d.matchedPrintId ? "Change print" : "Choose print" }}
                </UButton>
                <UButton
                  v-if="d.reviewStatus !== 'rejected'"
                  size="xs"
                  variant="ghost"
                  color="error"
                  @click="review(d.id, { action: 'reject' })"
                >
                  Not a print / wrong
                </UButton>
                <UInputNumber
                  v-if="d.matchedPrintId && d.reviewStatus !== 'rejected'"
                  :model-value="d.visibleCount ?? undefined"
                  :min="1"
                  placeholder="copies"
                  size="xs"
                  class="w-28"
                  @update:model-value="(v: number | null) => review(d.id, { action: 'confirm', visibleCount: v ?? null })"
                />
              </div>
              <div
                v-if="pickingFor === d.id"
                class="mt-3 rounded-md border border-default p-3"
              >
                <MpCatalogPicker
                  :initial-query="d.observedText ?? ''"
                  @pick="(p: CatalogFact) => onPick(d.id, p)"
                />
              </div>
            </li>
            <li
              v-if="!detectionsByUpload[upload.id]?.length"
              class="px-3 py-3 text-xs text-muted"
            >
              {{ upload.status === "done" ? "No prints were identified in this photo." : "Not identified yet." }}
            </li>
          </ul>
        </article>
      </div>
    </section>

    <UModal
      v-model:open="addOpen"
      title="Add a print manually"
      description="For prints you own that aren't in your photos. Quantity starts as unknown."
    >
      <template #body>
        <MpCatalogPicker @pick="addManual" />
      </template>
    </UModal>

    <UModal
      :open="!!enlarged"
      title="Photo"
      :ui="{ content: 'max-w-5xl' }"
      @update:open="(v: boolean) => { if (!v) enlarged = null; }"
    >
      <template #body>
        <img
          v-if="enlarged"
          :src="`/api/mp/uploads/${enlarged}/image`"
          alt=""
          class="w-full"
        >
      </template>
    </UModal>
  </MpPage>
</template>
