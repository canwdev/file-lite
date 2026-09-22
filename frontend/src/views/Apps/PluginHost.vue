<script lang="ts" setup>
import type { PluginInfo } from '@/api/plugins'
import type { AppParams } from '@/views/Apps/apps.ts'

const props = defineProps<{
  plugin: PluginInfo
  appParams: AppParams
}>()
const emit = defineEmits(['setTitle', 'exit'])

const isLoading = ref(true)

watch(
  () => props.plugin.name,
  (name) => {
    emit('setTitle', name)
  },
  { immediate: true },
)

watch(() => props.plugin.entryUrl, () => {
  isLoading.value = true
})

function handleLoad() {
  isLoading.value = false
}
</script>

<template>
  <div class="plugin-host">
    <iframe
      class="plugin-host__frame"
      :src="plugin.entryUrl"
      :title="plugin.name"
      allow="clipboard-read; clipboard-write"
      @load="handleLoad"
    />
    <div v-if="isLoading" class="plugin-host__status vgo-u-surface">
      Loading {{ plugin.name }}...
    </div>
  </div>
</template>

<style lang="scss" scoped>
.plugin-host {
  position: relative;
  width: 100%;
  height: 100%;

  &__frame {
    display: block;
    width: 100%;
    height: 100%;
    border: 0;
  }

  &__status {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--vgo-text-secondary);
  }
}
</style>
