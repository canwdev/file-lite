<script setup lang="ts">
import { computed, onUnmounted, reactive, ref } from 'vue'

defineProps<{
  src: string
}>()

const cardRef = ref<HTMLElement | null>(null)
const state = reactive({
  rotateX: 0,
  rotateY: 0,
  glareX: 50,
  glareY: 50,
  glareOpacity: 0,
  shadowX: 0,
  shadowY: 0,
  isHover: false,
})

let rafId: number | null = null

function handleMouseMove(e: MouseEvent) {
  if (!cardRef.value)
    return

  if (rafId)
    cancelAnimationFrame(rafId)

  rafId = requestAnimationFrame(() => {
    const rect = cardRef.value!.getBoundingClientRect()
    const offsetX = (e.clientX - (rect.left + rect.width / 2)) / (rect.width / 2)
    const offsetY = (e.clientY - (rect.top + rect.height / 2)) / (rect.height / 2)

    state.isHover = true
    state.rotateY = offsetX * 12 // 减小角度使动作更高级
    state.rotateX = -offsetY * 12
    state.glareX = (offsetX + 1) * 50
    state.glareY = (offsetY + 1) * 50
    state.glareOpacity = 0.5
    // 阴影反向移动，增加悬浮感
    state.shadowX = -offsetX * 15
    state.shadowY = -offsetY * 15
  })
}

function handleMouseLeave() {
  if (rafId)
    cancelAnimationFrame(rafId)
  state.isHover = false
  state.rotateX = 0
  state.rotateY = 0
  state.glareOpacity = 0
  state.shadowX = 0
  state.shadowY = 0
}

const wrapperStyle = computed(() => ({
  transform: `perspective(1000px) rotateX(${state.rotateX}deg) rotateY(${state.rotateY}deg) scale3d(${state.isHover ? 1.05 : 1}, ${state.isHover ? 1.05 : 1}, 1)`,
  transition: state.isHover ? 'transform 0.1s ease-out' : 'all 0.5s cubic-bezier(0.22, 1, 0.36, 1)',
}))

const glareStyle = computed(() => ({
  background: `radial-gradient(circle at ${state.glareX}% ${state.glareY}%, rgba(255, 255, 255, 0.3) 0%, rgba(255, 255, 255, 0) 70%)`,
  opacity: state.glareOpacity,
}))

const shadowStyle = computed(() => ({
  transform: `translate3d(${state.shadowX}px, ${state.shadowY}px, 0) scale(${state.isHover ? 0.95 : 0.9})`,
  opacity: state.isHover ? 0.6 : 0.3,
  transition: state.isHover ? 'transform 0.1s ease-out, opacity 0.2s' : 'all 0.5s ease',
}))

onUnmounted(() => {
  if (rafId)
    cancelAnimationFrame(rafId)
})
</script>

<template>
  <div
    ref="cardRef"
    class="steam-card-container"
    @mousemove="handleMouseMove"
    @mouseleave="handleMouseLeave"
  >
    <div class="card-shadow" :style="shadowStyle" />

    <div class="steam-card-wrapper" :style="wrapperStyle">
      <div class="inner-content">
        <img :src="src" class="card-image" alt="steam-card" @dragstart.prevent>
        <div class="card-glare" :style="glareStyle" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.steam-card-container {
  flex-shrink: 0;
  max-width: min(72vmin, 320px);
  aspect-ratio: 1 / 1;
  position: relative;
  /* 重要：不再在这里写 perspective，移到 wrapper 的 transform 里防止裁切冲突 */
  @media (min-width: 720px) {
    .art-column {
      max-width: 300px;
    }
  }
}

.steam-card-wrapper {
  position: relative;
  width: 100%;
  height: 100%;
  z-index: 2;
  /* 确保子元素在 3D 空间 */
  transform-style: preserve-3d;
}

.inner-content {
  width: 100%;
  height: 100%;
  border-radius: clamp(8px, 1.5vw, 14px);
  overflow: hidden; /* 图片圆角裁剪 */
  position: relative;
  backface-visibility: hidden;
  box-shadow:
    0 4px 6px rgba(0, 0, 0, 0.07),
    0 22px 48px rgba(0, 0, 0, 0.28),
    0 0 0 1px rgba(255, 255, 255, 0.06) inset;
}

.card-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: filter 0.35s ease;

  &:hover {
    filter: brightness(1.06) saturate(1.1);
  }
}

.card-glare {
  position: absolute;
  inset: 0;
  z-index: 5;
  pointer-events: none;
}

/* 核心修复：仿真的深层阴影 */
.card-shadow {
  position: absolute;
  inset: 10px;
  background: #000;
  filter: blur(20px);
  border-radius: 20px;
  z-index: 1; /* 永远在图片下方 */
  pointer-events: none;
  will-change: transform, opacity;
}
</style>
