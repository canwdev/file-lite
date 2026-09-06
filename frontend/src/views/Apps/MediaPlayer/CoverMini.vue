<script setup lang="ts">
import CoverDisplay from './CoverDisplay.vue'

interface Props {
  src?: string
  isVideo?: boolean
}
withDefaults(defineProps<Props>(), {
})
</script>

<template>
  <button class="vgo-u-button-reset btn-cover">
    <slot />
    <CoverDisplay v-if="src" :src="src" />
    <MdiIcon v-else class="icon-wrap" :name="isVideo ? 'video-outline' : 'music-note'" />
  </button>
</template>

<style lang="scss" scoped>
.btn-cover {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 50px;
  height: 50px;
  overflow: hidden;
  border-radius: var(--vgo-radius-lg);
  background-color: var(--vgo-hover);

  .cover-display {
    width: 100%;
    height: 100%;
  }

  .icon-wrap {
    font-size: var(--vgo-icon-lg);
    color: var(--vgo-text-secondary);
  }
}
</style>
