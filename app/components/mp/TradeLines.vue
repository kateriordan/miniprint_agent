<script setup lang="ts">
import type { TradeLine } from "#shared/miniprint/types";
import type { CatalogMap } from "~/composables/useMiniprint";

defineProps<{
  requested: TradeLine[];
  offered: TradeLine[];
  catalog: CatalogMap;
}>();
</script>

<template>
  <div class="grid gap-3 sm:grid-cols-2">
    <div>
      <p class="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted">
        You would give
      </p>
      <ul class="space-y-1">
        <li
          v-for="(line, i) in requested"
          :key="i"
        >
          <MpPrintChip
            :label="line.label"
            :quantity="line.quantity"
            :print="line.printId ? catalog[line.printId] : null"
            :match-status="line.matchStatus"
          />
        </li>
        <li
          v-if="requested.length === 0"
          class="text-sm text-dimmed"
        >
          Nothing recorded
        </li>
      </ul>
    </div>
    <div>
      <p class="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted">
        You would receive
      </p>
      <ul class="space-y-1">
        <li
          v-for="(line, i) in offered"
          :key="i"
        >
          <MpPrintChip
            :label="line.label"
            :quantity="line.quantity"
            :print="line.printId ? catalog[line.printId] : null"
            :match-status="line.matchStatus"
          />
        </li>
        <li
          v-if="offered.length === 0"
          class="text-sm text-dimmed"
        >
          Nothing recorded
        </li>
      </ul>
    </div>
  </div>
</template>
