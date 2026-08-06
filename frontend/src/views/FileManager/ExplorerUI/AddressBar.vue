<script setup lang="ts">
import type { MenuItem } from '@imengyu/vue3-context-menu'
import ContextMenu from '@imengyu/vue3-context-menu'
import { menuThemeOptions } from '@/hooks/use-global-theme'
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
  'navigate': [string, string | null]
  'openPathInNewTab': [string]
  'refresh': []
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

function commitFromEdit(opts?: { refreshIfUnchanged?: boolean }) {
  if (!editing.value) {
    return
  }
  const next = normalizePath(editDraft.value.trim() || '/')
  editing.value = false
  if (normalizeListingPath(next) === normalizeListingPath(props.modelValue)) {
    if (opts?.refreshIfUnchanged) {
      emit('refresh')
    }
    return
  }
  // Emit navigate before v-model so the parent still sees the old path when
  // handleOpenPath compares; otherwise basePath updates first and refresh is skipped.
  emit('navigate', next, null)
  emit('update:modelValue', next)
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
  // Highlight the folder name that's the direct child of the clicked parent path
  let highlightName: string | null = null
  const currentNormalized = normalizeListingPath(props.modelValue)
  const targetNormalized = normalizeListingPath(path)
  if (currentNormalized.startsWith(targetNormalized) && currentNormalized !== targetNormalized) {
    const remaining = currentNormalized.slice(targetNormalized.length)
    highlightName = remaining.split('/').filter(Boolean)[0] || null
  }
  emit('navigate', path, highlightName)
}

function showCrumbMenu(path: string, event: MouseEvent) {
  const items: MenuItem[] = [
    {
      label: 'Open in new Tab',
      icon: 'mdi mdi-open-in-new',
      onClick: () => emit('openPathInNewTab', path),
    },
  ]

  ContextMenu.showContextMenu({
    x: event.clientX,
    y: event.clientY,
    ...menuThemeOptions,
    items,
  })
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
    commitFromEdit({ refreshIfUnchanged: true })
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
            class="addr-crumb vgo-u-button-reset"
            :title="seg.path"
            @click.stop="onCrumbClick(seg.path)"
            @contextmenu.prevent.stop="showCrumbMenu(seg.path, $event)"
          >
            <span class="addr-crumb-text vgo-u-text-overflow">{{ seg.name }}</span>
          </button>
        </template>
      </template>
      <button
        v-else
        type="button"
        class="addr-crumb addr-crumb-placeholder vgo-u-button-reset"
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
  min-width: 100px;
  height: var(--vgo-control-md);
  display: flex;
  align-items: stretch;
  transition: border-color var(--vgo-duration-fast) ease;
  padding: 0;
  overflow: hidden;

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
  border-radius: var(--vgo-radius);
  line-height: 1;
  padding: 0 var(--vgo-space-2);
  height: 100%;
  font-size: var(--vgo-font-md);
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

  @media screen and (max-width: $mq_mobile_width) {
    min-width: 120px;
  }
  padding: 0 var(--vgo-space-1);
  gap: 0;
  font-size: var(--vgo-font-md);
  cursor: text;
  scrollbar-width: none;
}

.addr-crumb-sep {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  padding: 0 1px;
  font-size: var(--vgo-font-md);
  pointer-events: none;
  user-select: none;
  line-height: 1;
}

.addr-crumb {
  flex-shrink: 0;
  max-width: 200px;
  padding: var(--vgo-space-1);
  margin: 0;
  border-radius: var(--vgo-radius);
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
  line-height: 1.3;
}

.addr-crumb-placeholder {
  max-width: none;
  color: var(--vgo-text-placeholder);
}
</style>
