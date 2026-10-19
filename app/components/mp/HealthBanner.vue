<script setup lang="ts">
/** Always-visible statement of how current the message data is. */
const { data } = await useFetch("/api/mp/health", { key: "mp-health-banner" });
</script>

<template>
  <UAlert
    v-if="data"
    color="neutral"
    variant="subtle"
    icon="i-lucide-unplug"
    title="Messages are not monitored live"
  >
    <template #description>
      <span>
        Last successful import: <strong>{{ formatDate(data.lastSuccessfulIngestionAt) }}</strong>.
        <template v-if="data.knownGaps.length"> {{ data.knownGaps.length }} known gap(s) in coverage.</template>
        <template v-if="data.messages.pending"> {{ data.messages.pending }} message(s) waiting for analysis.</template>
        <NuxtLink
          to="/health"
          class="underline"
        >System health</NuxtLink>
      </span>
    </template>
  </UAlert>
</template>
