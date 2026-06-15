<script setup lang="ts">
import type { CSSProperties } from 'vue'
import type { IEntry } from '@/types/server'
import { onClickOutside, useEventListener } from '@vueuse/core'
import { nextTick, ref, watch } from 'vue'

const props = withDefaults(defineProps<{
  item: IEntry | null
  container: HTMLElement | null
  modelValue: string
  submitting?: boolean
}>(), {
  submitting: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
  'confirm': []
  'cancel': []
}>()

const inputRef = ref<HTMLInputElement | null>(null)
const overlayRef = ref<HTMLElement | null>(null)
const overlayStyle = ref<CSSProperties>()

const HORIZONTAL_PADDING = 0
const MIN_WIDTH = 200

function getRenameTarget(container: HTMLElement, name: string) {
  return [...container.querySelectorAll<HTMLElement>('[data-rename-target]')]
    .find(el => el.dataset.renameTarget === name) ?? null
}

function getDefaultSelectionEnd() {
  if (!props.item || props.item.isDirectory)
    return props.modelValue.length
  const extIndex = props.modelValue.lastIndexOf('.')
  return extIndex > 0 ? extIndex : props.modelValue.length
}

function updatePosition() {
  if (!props.item || !props.container) {
    overlayStyle.value = undefined
    return
  }
  const target = getRenameTarget(props.container, props.item.name)
  if (!target) {
    overlayStyle.value = undefined
    return
  }
  const containerRect = props.container.getBoundingClientRect()
  const targetRect = target.getBoundingClientRect()
  const width = Math.max(targetRect.width + HORIZONTAL_PADDING, MIN_WIDTH)
  const left = targetRect.left - containerRect.left + props.container.scrollLeft - (width - targetRect.width) / 2
  overlayStyle.value = {
    left: `${Math.max(left, props.container.scrollLeft)}px`,
    top: `${targetRect.top - containerRect.top + props.container.scrollTop}px`,
    width: `${width}px`,
    minHeight: `${targetRect.height}px`,
  }
}

async function focusInput() {
  await nextTick()
  updatePosition()
  await nextTick()
  inputRef.value?.focus()
  inputRef.value?.setSelectionRange(0, getDefaultSelectionEnd())
}

function confirm() {
  if (!props.submitting)
    emit('confirm')
}

function cancel() {
  if (!props.submitting)
    emit('cancel')
}

// Handle keys inside the input: Enter = confirm, Esc = cancel, stop all propagation
function handleKeydown(event: KeyboardEvent) {
  event.stopPropagation()
  if (event.key === 'Escape') {
    event.preventDefault()
    cancel()
  }
  else if (event.key === 'Enter') {
    event.preventDefault()
    confirm()
  }
}

// Intercept all keyboard events at window capture phase when rename is active,
// so hotkeys in the parent explorer don't fire while renaming
useEventListener(window, 'keydown', (event: KeyboardEvent) => {
  if (!props.item)
    return
  // Events from within overlay are handled by handleKeydown above
  if (overlayRef.value?.contains(event.target as Node))
    return
  event.preventDefault()
  event.stopImmediatePropagation()
  if (event.key === 'Escape')
    cancel()
}, { capture: true })

watch(() => props.item, (item) => {
  if (item)
    focusInput()
  else
    overlayStyle.value = undefined
})

watch(() => props.submitting, (submitting) => {
  if (!submitting && props.item)
    focusInput()
})

watch(() => props.modelValue, updatePosition)
useEventListener(() => props.container, 'scroll', updatePosition, { passive: true })
useEventListener(window, 'resize', updatePosition, { passive: true })
onClickOutside(() => overlayRef.value, cancel)
</script>

<template>
  <!-- Full-screen mask blocks all pointer interaction with the file list -->
  <div
    v-if="item"
    class="file-rename-mask"
    @mousedown.stop.prevent
    @click.stop.prevent
    @dblclick.stop.prevent
    @contextmenu.stop.prevent
    @wheel.stop.prevent
  />

  <div
    v-if="item && overlayStyle"
    ref="overlayRef"
    class="file-rename-overlay"
    :style="overlayStyle"
    @click.stop
    @mousedown.stop
    @dblclick.stop
    @contextmenu.stop
    @keyup.stop
  >
    <div class="file-rename-overlay__card vgo-panel" :class="{ 'is-submitting': submitting }">
      <input
        ref="inputRef"
        class="file-rename-overlay__input vgo-input"
        :disabled="submitting"
        :value="modelValue"
        spellcheck="false"
        @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
        @keydown="handleKeydown"
        @keyup.stop
      >

      <div class="file-rename-overlay__actions">
        <button
          class="rename-btn rename-btn--confirm vgo-button primary"
          :disabled="submitting"
          title="Confirm (Enter)"
          @click.stop="confirm"
        >
          <span class="mdi mdi-check" />
        </button>
        <button
          class="rename-btn rename-btn--cancel vgo-button"
          :disabled="submitting"
          title="Cancel (Esc)"
          @click.stop="cancel"
        >
          <span class="mdi mdi-close" />
        </button>
      </div>

      <div v-if="submitting" class="file-rename-overlay__spinner">
        <span class="mdi mdi-loading mdi-spin" />
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.file-rename-mask {
  position: fixed;
  inset: 0;
  z-index: 29;
  cursor: default;
}

.file-rename-overlay {
  position: absolute;
  z-index: 30;
  box-sizing: border-box;
  pointer-events: auto;
}

.file-rename-overlay__card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 6px;

  &.is-submitting {
    opacity: 0.7;
  }
}

.file-rename-overlay__input {
  width: 100%;
  box-sizing: border-box;
  padding: 4px 8px;
  font: inherit;
  font-size: 0.9em;
  color: inherit;
  text-align: inherit;
  user-select: text;
}

.file-rename-overlay__actions {
  display: flex;
  justify-content: center;
  gap: 6px;
}

.rename-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  font-size: 16px;
  cursor: pointer;

  &:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
}

.file-rename-overlay__spinner {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  color: var(--vgo-primary);
  pointer-events: none;
}

@keyframes rename-pop-in {
  from {
    opacity: 0;
    transform: scale(0.92);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}
</style>
