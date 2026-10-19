<script setup lang="ts">
defineProps<{
  id: string;
  title: string;
  description?: string;
  wide?: boolean;
}>();
</script>

<template>
  <UDashboardPanel
    :id="id"
    class="min-h-0"
    :ui="{ body: 'p-0 sm:p-0' }"
  >
    <template #header>
      <AppNavbar />
    </template>

    <template #body>
      <div
        class="mx-auto w-full px-4 py-8 pt-16 sm:px-6"
        :class="wide ? 'max-w-6xl' : 'max-w-4xl'"
      >
        <header class="mb-6 flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0">
            <h1 class="mb-1 text-lg font-medium text-highlighted">
              {{ title }}
            </h1>
            <p
              v-if="description"
              class="max-w-2xl text-sm text-muted"
            >
              {{ description }}
            </p>
          </div>
          <div class="flex flex-wrap gap-2">
            <slot name="actions" />
          </div>
        </header>
        <slot />
      </div>
    </template>
  </UDashboardPanel>
</template>
