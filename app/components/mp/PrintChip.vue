<script setup lang="ts">
import type { CatalogFact } from "~/composables/useMiniprint";

/** A print with its MiniPrint.io facts. Rarity is shown only when verified. */
const props = defineProps<{
  label: string;
  quantity?: number | null;
  print?: CatalogFact | null;
  matchStatus?: string;
}>();

const rarityColor = computed(() => {
  switch (props.print?.rarity) {
    case "common": return "neutral" as const;
    case "limited": return "info" as const;
    case "unicorn":
    case "ooc": return "warning" as const;
    default: return "neutral" as const;
  }
});
</script>

<template>
  <span class="inline-flex flex-wrap items-center gap-1.5 text-sm">
    <span
      v-if="quantity"
      class="text-muted"
    >{{ quantity }}×</span>
    <a
      v-if="print"
      :href="print.catalogUrl"
      target="_blank"
      rel="noopener noreferrer"
      class="font-medium text-highlighted hover:underline"
      :title="`MiniPrint.io catalog record · verified ${print.verifiedAt ?? 'never'}`"
    >{{ print.canonicalName }}</a>
    <span
      v-else
      class="font-medium text-highlighted"
    >“{{ label }}”</span>
    <span
      v-if="print"
      class="text-xs text-muted"
    >{{ print.artist }}</span>
    <UBadge
      v-if="print?.rarity"
      :color="rarityColor"
      variant="subtle"
      size="sm"
    >
      {{ print.rarity }}
    </UBadge>
    <UBadge
      v-else-if="print"
      color="warning"
      variant="outline"
      size="sm"
    >
      rarity unverified
    </UBadge>
    <UBadge
      v-if="print?.circulationStatus === 'out_of_circulation'"
      color="warning"
      variant="outline"
      size="sm"
    >
      OOC
    </UBadge>
    <UBadge
      v-if="print?.verificationStatus === 'stale'"
      color="neutral"
      variant="outline"
      size="sm"
    >
      needs refresh
    </UBadge>
    <UBadge
      v-if="!print && matchStatus"
      color="error"
      variant="outline"
      size="sm"
    >
      {{ matchStatus === "unmatched" ? "not in catalog" : matchStatus === "candidate" ? "possible match — confirm" : "ambiguous" }}
    </UBadge>
  </span>
</template>
