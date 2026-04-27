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
  <button class="btn-no-style btn-cover flex items-center justify-center">
    <slot />
    <CoverDisplay v-if="src" :src="src" />
    <i v-else class="icon-wrap mdi" :class="[isVideo ? 'mdi-video-outline' : 'mdi-music-note']" />
  </button>
</template>

<style lang="scss" scoped>
.btn-cover {
  position: relative;
  width: 50px;
  height: 50px;
  overflow: hidden;
  background:
    linear-gradient(135deg, rgba(255, 255, 255, 0.18), rgba(255, 255, 255, 0.04)),
    rgba(128, 128, 128, 0.12);

  .cover-display {
    width: 100%;
    height: 100%;
  }
  .icon-wrap {
    font-size: 24px;
    color: var(--el-text-color-secondary);
  }
}
</style>
