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
const horizontalPadding = 32
const minInputWidth = 160

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
  const inputWidth = Math.max(targetRect.width + horizontalPadding, minInputWidth)
  const left = targetRect.left - containerRect.left + props.container.scrollLeft - (inputWidth - targetRect.width) / 2
  overlayStyle.value = {
    left: `${Math.max(left, props.container.scrollLeft)}px`,
    top: `${targetRect.top - containerRect.top + props.container.scrollTop}px`,
    width: `${inputWidth}px`,
    minHeight: `${targetRect.height}px`,
  }
}

async function focusInput() {
  await nextTick()
  updatePosition()
  await nextTick()
  const input = inputRef.value
  input?.focus()
  input?.setSelectionRange(0, getDefaultSelectionEnd())
}

function handleInput(event: Event) {
  emit('update:modelValue', (event.target as HTMLInputElement).value)
}

function handleInputKeydown(event: KeyboardEvent) {
  event.stopPropagation()

  if (event.key === 'Escape' || event.key === 'Esc') {
    event.preventDefault()
    event.stopImmediatePropagation()
    cancel()
    return
  }

  if (event.key === 'Enter') {
    event.preventDefault()
    event.stopImmediatePropagation()
    confirm()
  }
}

function handleWindowKeydown(event: KeyboardEvent) {
  if (!props.item) {
    return
  }

  if (event.key === 'Escape' || event.key === 'Esc') {
    event.preventDefault()
    event.stopImmediatePropagation()
    cancel()
    return
  }

  if (isEventFromOverlay(event)) {
    return
  }

  event.preventDefault()
  event.stopImmediatePropagation()
}

function confirm() {
  if (!props.submitting) {
    emit('confirm')
  }
}

function cancel() {
  if (!props.submitting) {
    emit('cancel')
  }
}

watch(() => props.item, (item) => {
  if (item) {
    focusInput()
  }
  else {
    overlayStyle.value = undefined
  }
})

watch(() => props.submitting, (submitting) => {
  if (!submitting && props.item) {
    focusInput()
  }
})

watch(() => props.modelValue, () => updatePosition())
useEventListener(() => props.container, 'scroll', updatePosition, { passive: true })
useEventListener(window, 'resize', updatePosition, { passive: true })
useEventListener(window, 'keydown', handleWindowKeydown, { capture: true })
onClickOutside(() => overlayRef.value, cancel)

function getRenameTarget(container: HTMLElement, name: string) {
  return [...container.querySelectorAll<HTMLElement>('[data-rename-target]')]
    .find(el => el.dataset.renameTarget === name) ?? null
}

function getDefaultSelectionEnd() {
  if (!props.item || props.item.isDirectory) {
    return props.modelValue.length
  }

  const extIndex = props.modelValue.lastIndexOf('.')
  return extIndex > 0 ? extIndex : props.modelValue.length
}

function isEventFromOverlay(event: Event) {
  const target = event.target
  return target instanceof Node && !!overlayRef.value?.contains(target)
}
</script>

<template>
  <div
    v-if="item"
    class="file-rename-mask"
    @mousedown.stop.prevent
    @click.stop.prevent="cancel"
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
    @keydown.stop
    @keyup.stop
  >
    <input
      ref="inputRef"
      class="file-rename-overlay__input"
      :disabled="submitting"
      :value="modelValue"
      spellcheck="false"
      @input="handleInput"
      @keydown="handleInputKeydown"
      @keyup.stop
    >
    <div class="file-rename-overlay__actions">
      <button
        class="vgo-button  btn-no-style"
        :disabled="submitting"
        title="Confirm rename"
        @click.stop="confirm"
      >
        ✓
      </button>
      <button
        class="vgo-button btn-no-style"
        :disabled="submitting"
        title="Cancel rename"
        @click.stop="cancel"
      >
        ✕
      </button>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.file-rename-mask {
  position: fixed;
  inset: 0;
  z-index: 29;
  background: transparent;
}

.file-rename-overlay {
  position: absolute;
  z-index: 30;
  box-sizing: border-box;
  pointer-events: auto;
}

.file-rename-overlay__input {
  width: 100%;
  min-height: 100%;
  box-sizing: border-box;
  padding: 2px 4px;
  font: inherit;
  color: inherit;
  text-align: inherit;
  border: 1px solid var(--vgo-primary);
  outline: none;
  user-select: text;
  box-shadow: 0 0 0 1px var(--vgo-primary-opacity);
}

.file-rename-overlay__actions {
  display: flex;
  justify-content: center;
  gap: 4px;
  margin-top: 4px;

  .vgo-button {
    border-radius: 0;
  }
}
</style>
