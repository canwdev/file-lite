<script setup lang="ts">
import { normalizeListingPath, normalizePath } from '../utils'

export interface BreadcrumbSegment {
  name: string
  path: string
}

const props = defineProps<{
  modelValue: string
}>()

const emit = defineEmits<{
  'update:modelValue': [string]
  'navigate': [string]
}>()

function getBreadcrumbSegments(path: string): BreadcrumbSegment[] {
  const raw = (path || '').trim()
  if (!raw) {
    return []
  }
  const normalized = normalizePath(raw)
  const trimmed = normalized.replace(/\/+$/, '') || '/'

  if (trimmed === '/') {
    return [{ name: '/', path: '/' }]
  }

  const isUnix = trimmed.startsWith('/')
  const out: BreadcrumbSegment[] = []

  if (isUnix) {
    out.push({ name: '/', path: '/' })
    const rest = trimmed.slice(1)
    const segments = rest.split('/').filter(Boolean)
    let acc = ''
    for (const seg of segments) {
      acc = `${acc}/${seg}`
      out.push({ name: seg, path: `${acc}/` })
    }
  }
  else {
    const segments = trimmed.split('/').filter(Boolean)
    let acc = ''
    for (let i = 0; i < segments.length; i++) {
      acc = i === 0 ? segments[i] : `${acc}/${segments[i]}`
      out.push({ name: segments[i], path: `${acc}/` })
    }
  }

  return out
}

const editing = ref(false)
const editDraft = ref('')
const inputRef = ref<HTMLInputElement | null>(null)
const breadcrumbScrollRef = ref<HTMLElement | null>(null)

const segments = computed(() => getBreadcrumbSegments(props.modelValue))

function scrollBreadcrumbToEnd() {
  const el = breadcrumbScrollRef.value
  if (!el || editing.value) {
    return
  }
  if (el.scrollWidth > el.clientWidth) {
    el.scrollLeft = el.scrollWidth - el.clientWidth
  }
}

watch(
  () => props.modelValue,
  () => {
    nextTick(() => {
      scrollBreadcrumbToEnd()
    })
  },
  { flush: 'post' },
)

watch(editing, (isEditing: boolean) => {
  if (!isEditing) {
    nextTick(() => {
      scrollBreadcrumbToEnd()
    })
  }
})

onMounted(() => {
  nextTick(() => {
    scrollBreadcrumbToEnd()
  })
})

function startEdit() {
  editDraft.value = props.modelValue
  editing.value = true
  nextTick(() => {
    inputRef.value?.focus()
    inputRef.value?.select()
  })
}

function commitFromEdit() {
  if (!editing.value) {
    return
  }
  const next = normalizePath(editDraft.value.trim() || '/')
  editing.value = false
  if (normalizeListingPath(next) === normalizeListingPath(props.modelValue)) {
    return
  }
  emit('update:modelValue', next)
  emit('navigate', next)
}

function cancelEdit() {
  editing.value = false
}

function onCrumbClick(path: string) {
  if (editing.value) {
    return
  }
  if (normalizeListingPath(path) === normalizeListingPath(props.modelValue)) {
    return
  }
  emit('navigate', path)
}

function onBreadcrumbBarClick(event: MouseEvent) {
  if (editing.value) {
    return
  }
  const target = event.target as HTMLElement | null
  if (target?.closest('.addr-crumb, .addr-crumb-sep')) {
    return
  }
  startEdit()
}

function onInputKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault()
    commitFromEdit()
  }
  else if (e.key === 'Escape') {
    e.preventDefault()
    cancelEdit()
  }
}

function onInputBlur() {
  if (!editing.value) {
    return
  }
  commitFromEdit()
}

defineExpose({
  focus() {
    startEdit()
  },
})
</script>

<template>
  <div
    class="address-bar vgo-input"
    :class="{ 'is-editing': editing }"
    :title="editing ? '' : 'Address bar — click empty area to edit (Alt+A)'"
  >
    <input
      v-show="editing"
      ref="inputRef"
      v-model="editDraft"
      type="text"
      class="address-bar-input vgo-input"
      placeholder="Path"
      @keydown="onInputKeydown"
      @blur="onInputBlur"
    >
    <div
      v-show="!editing"
      ref="breadcrumbScrollRef"
      class="address-bar-breadcrumb"
      role="navigation"
      aria-label="Path"
      @click="onBreadcrumbBarClick"
    >
      <template v-if="segments.length">
        <template v-for="(seg, index) in segments" :key="`${seg.path}-${index}`">
          <span v-if="index !== 0" class="addr-crumb-sep" aria-hidden="true">
            <span class="mdi mdi-chevron-right" />
          </span>
          <button
            type="button"
            class="addr-crumb btn-no-style"
            :title="seg.path"
            @click.stop="onCrumbClick(seg.path)"
          >
            <span class="addr-crumb-text">{{ seg.name }}</span>
          </button>
        </template>
      </template>
      <button
        v-else
        type="button"
        class="addr-crumb addr-crumb-placeholder btn-no-style"
        @click.stop="startEdit"
      >
        Path
      </button>
    </div>
  </div>
</template>

<style scoped lang="scss">
.address-bar {
  flex: 1;
  min-width: 0;
  height: 26px;
  display: flex;
  align-items: stretch;
  transition: border-color 0.12s ease, box-shadow 0.12s ease;
  padding: 0;

  &.is-editing {
    border: 1px solid var(--vgo-primary);
    outline: none;
  }
}

.address-bar-input {
  flex: 1;
  width: 100%;
  min-width: 0;
  border: none !important;
  border-radius: 2px;
  line-height: 1;
  padding: 4px 8px;
  height: 100%;
  font-size: 14px;
  background: transparent;
  outline: none;
  box-shadow: none !important;
}

.address-bar-breadcrumb {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  overflow-x: auto;
  overflow-y: hidden;
  padding: 0 4px;
  gap: 0;
  scrollbar-width: thin;
  font-size: 14px;
  cursor: text;
  scrollbar-width: none;
}

.addr-crumb-sep {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  padding: 0 1px;
  font-size: 14px;
  pointer-events: none;
  user-select: none;
  line-height: 1;
}

.addr-crumb {
  flex-shrink: 0;
  max-width: 200px;
  padding: 4px 4px;
  margin: 0;
  border-radius: 2px;
  line-height: 1.3;
  cursor: pointer;
  text-align: left;

  &:hover,
  &:focus-visible {
    background: var(--vgo-primary-opacity);
  }

  &:focus-visible {
    outline: 1px solid var(--vgo-primary);
    outline-offset: -1px;
  }
}

.addr-crumb-text {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1;
}

.addr-crumb-placeholder {
  color: var(--vgo-color-text-placeholder, #767676);
  max-width: none;
  font-style: normal;
}
</style>
