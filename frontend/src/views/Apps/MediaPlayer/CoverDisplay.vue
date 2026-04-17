<script setup lang="ts">
withDefaults(defineProps<{
  src?: string | null
  isRounded?: boolean
  isRotating?: boolean
}>(), {
  isRounded: false,
  isRotating: false,
})
</script>

<template>
  <div class="cover-display">
    <img v-if="src" :src="src" :class="{ rounded: isRounded, rotating: isRotating }">
    <span
      v-else
      class="cover-icon mdi mdi-music-note"
    />
  </div>
</template>

<style lang="scss" scoped>
.cover-display {
  position: relative;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 200px;
  height: 200px;

  .cover-icon {
    font-size: 64px;
    opacity: .3;
  }

  img {
    position: relative;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    animation: rotating360 60s infinite linear;
    animation-play-state: paused;
    border-radius: inherit;
    overflow: hidden;

    &.rounded {
      border-radius: 50%;
    }
    &.rotating {
      animation-play-state: running;
    }
  }
}
</style>
