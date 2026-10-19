<script setup lang="ts">
import type { CatalogFact } from "~/composables/useMiniprint";

const props = defineProps<{ initialQuery?: string }>();
const emit = defineEmits<{ pick: [print: CatalogFact] }>();

const query = ref(props.initialQuery ?? "");
const results = ref<CatalogFact[]>([]);
const matchNote = ref("");
const loading = ref(false);

async function search() {
  if (!query.value.trim()) return;
  loading.value = true;
  try {
    const res = await $fetch<{ match: { status: string; reason: string }; results: CatalogFact[] }>("/api/mp/catalog/search", { query: { q: query.value } });
    results.value = res.results;
    matchNote.value = `${res.match.status}: ${res.match.reason}`;
  }
  finally {
    loading.value = false;
  }
}

onMounted(() => {
  if (query.value) search();
});
</script>

<template>
  <div class="space-y-2">
    <form
      class="flex gap-2"
      @submit.prevent="search"
    >
      <UInput
        v-model="query"
        placeholder="Search MiniPrint.io catalog"
        class="flex-1"
        icon="i-lucide-search"
      />
      <UButton
        type="submit"
        :loading="loading"
        variant="outline"
        color="neutral"
      >
        Search
      </UButton>
    </form>
    <p
      v-if="matchNote"
      class="text-xs text-muted"
    >
      {{ matchNote }}
    </p>
    <ul class="max-h-64 divide-y divide-default overflow-y-auto rounded-md border border-default">
      <li
        v-for="r in results"
        :key="r.printId"
        class="flex items-center gap-3 px-3 py-2"
      >
        <img
          v-if="r.imageUrl"
          :src="r.imageUrl"
          alt=""
          class="size-10 shrink-0 rounded object-cover"
          loading="lazy"
          referrerpolicy="no-referrer"
        >
        <MpPrintChip
          class="min-w-0 flex-1"
          :label="r.canonicalName"
          :print="r"
        />
        <UButton
          size="xs"
          @click="emit('pick', r)"
        >
          Choose
        </UButton>
      </li>
      <li
        v-if="!results.length"
        class="px-3 py-2 text-xs text-dimmed"
      >
        No results yet
      </li>
    </ul>
  </div>
</template>
