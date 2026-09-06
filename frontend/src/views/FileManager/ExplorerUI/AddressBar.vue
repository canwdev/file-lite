<script setup lang="ts">
import type { MenuItem } from '@imengyu/vue3-context-menu'
import type { IEntry } from '@/types/server'
import ContextMenu from '@imengyu/vue3-context-menu'
import { menuThemeOptions } from '@/hooks/use-global-theme'
import { normalizeListingPath, normalizePath } from '../utils'
import { applyFolderListSort, getSortedFolderEntries, readFolderRawList, wasFolderListingOk } from './folder-listing'

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

// 面包屑溢出折叠：内容放不下时不出现滚动条，自动只展示末尾最多 2 个 crumb
const hiddenPrefixCount = ref(0)
/** 测量阶段临时显示全部 crumb（同一帧内完成，不会闪烁） */
const measuring = ref(false)
let breadcrumbResizeObserver: ResizeObserver | null = null

async function recomputeBreadcrumbFit() {
  const el = breadcrumbScrollRef.value
  if (!el || editing.value) {
    return
  }
  measuring.value = true
  await nextTick()
  const wouldOverflow = el.scrollWidth > el.clientWidth + 1
  measuring.value = false
  hiddenPrefixCount.value = wouldOverflow ? Math.max(0, segments.value.length - 2) : 0
  await nextTick()
}

watch(
  () => props.modelValue,
  () => {
    closeCrumbMenu()
    recomputeBreadcrumbFit()
  },
  { flush: 'post' },
)

watch(editing, (isEditing: boolean) => {
  if (isEditing) {
    closeCrumbMenu()
  }
  else {
    recomputeBreadcrumbFit()
  }
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
  if (target?.closest('.addr-crumb, .addr-crumb-caret')) {
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

// ---------------------------------------------------------------------------
// 面包屑「▼」下拉：列出该段目录的子文件夹（按该目录自身排序规则），点击导航。
// ---------------------------------------------------------------------------
const CRUMB_MENU_WIDTH = 220
const CRUMB_MENU_VIEWPORT_MARGIN = 8
const CRUMB_MENU_MAX_HEIGHT = 360

interface CrumbMenuPos {
  left: number
  top: number
  width: number
  maxHeight: number
}

const crumbMenu = ref<BreadcrumbSegment | null>(null)
const crumbMenuPos = ref<CrumbMenuPos | null>(null)
const crumbMenuLoading = ref(false)
const crumbMenuSubDirs = ref<IEntry[]>([])
const crumbMenuError = ref(false)
const menuActiveIndex = ref(-1)
const crumbMenuRef = ref<HTMLElement | null>(null)

const crumbMenuPanelStyle = computed(() => {
  const pos = crumbMenuPos.value
  if (!pos) {
    return {}
  }
  return {
    left: `${pos.left}px`,
    top: `${pos.top}px`,
    width: `${pos.width}px`,
    maxHeight: `${pos.maxHeight}px`,
  }
})

function openCrumbMenu(seg: BreadcrumbSegment, anchor: HTMLElement) {
  const rect = anchor.getBoundingClientRect()
  const width = CRUMB_MENU_WIDTH
  const { innerWidth, innerHeight } = window
  const left = Math.min(
    Math.max(rect.left, CRUMB_MENU_VIEWPORT_MARGIN),
    Math.max(CRUMB_MENU_VIEWPORT_MARGIN, innerWidth - CRUMB_MENU_VIEWPORT_MARGIN - width),
  )
  const top = rect.bottom + 4
  const maxHeight = Math.max(
    120,
    Math.min(CRUMB_MENU_MAX_HEIGHT, innerHeight - top - CRUMB_MENU_VIEWPORT_MARGIN),
  )
  crumbMenuPos.value = { left, top, width, maxHeight }
  crumbMenu.value = { name: seg.name, path: seg.path }
  menuActiveIndex.value = -1
  loadCrumbMenuEntries(seg.path)
  nextTick(() => crumbMenuRef.value?.focus())
}

function closeCrumbMenu() {
  crumbMenu.value = null
  crumbMenuPos.value = null
  crumbMenuLoading.value = false
  crumbMenuSubDirs.value = []
  crumbMenuError.value = false
  menuActiveIndex.value = -1
}

function onCrumbCaretClick(seg: BreadcrumbSegment, event: MouseEvent) {
  if (editing.value) {
    return
  }
  if (crumbMenu.value?.path === seg.path) {
    closeCrumbMenu()
    return
  }
  openCrumbMenu(seg, event.currentTarget as HTMLElement)
}

async function loadCrumbMenuEntries(path: string) {
  crumbMenuError.value = false
  crumbMenuSubDirs.value = []
  // 命中缓存时同步展示，避免已加载过的目录再次闪烁 Loading
  if (wasFolderListingOk(path)) {
    crumbMenuSubDirs.value = getSortedFolderEntries(path).filter(item => item.isDirectory)
    return
  }
  crumbMenuLoading.value = true
  const raw = await readFolderRawList(path)
  if (crumbMenu.value?.path !== path) {
    return
  }
  crumbMenuLoading.value = false
  crumbMenuError.value = !wasFolderListingOk(path) && raw.length === 0
  const sorted = applyFolderListSort(path, raw)
  crumbMenuSubDirs.value = sorted.filter(item => item.isDirectory)
}

function onMenuPick(dir: IEntry) {
  const seg = crumbMenu.value
  closeCrumbMenu()
  if (!seg) {
    return
  }
  onCrumbClick(`${seg.path}${dir.name}/`)
}

function onMenuKeydown(e: KeyboardEvent) {
  const list = crumbMenuSubDirs.value
  if (!list.length) {
    if (e.key === 'Escape') {
      closeCrumbMenu()
    }
    return
  }

  let next = menuActiveIndex.value
  switch (e.key) {
    case 'ArrowDown':
      next = next + 1 >= list.length ? 0 : next + 1
      break
    case 'ArrowUp':
      next = next <= 0 ? list.length - 1 : next - 1
      break
    case 'Home':
      next = 0
      break
    case 'End':
      next = list.length - 1
      break
    case 'Enter':
      if (menuActiveIndex.value >= 0) {
        e.preventDefault()
        onMenuPick(list[menuActiveIndex.value])
      }
      return
    case 'Escape':
      e.preventDefault()
      closeCrumbMenu()
      return
    default:
      return
  }
  e.preventDefault()
  menuActiveIndex.value = next
  const panel = crumbMenuRef.value
  const button = panel?.querySelectorAll<HTMLElement>('.crumb-menu-row')[next]
  button?.scrollIntoView({ block: 'nearest' })
}

function onWindowPointerDown(e: PointerEvent) {
  const target = e.target as HTMLElement | null
  if (target?.closest('.addr-crumb-caret, .addr-crumb-menu')) {
    return
  }
  closeCrumbMenu()
}

function onWindowScroll(e: Event) {
  // 菜单内部滚动（如键盘高亮 scrollIntoView）不关闭
  const target = e.target as Element | null
  if (target?.closest?.('.addr-crumb-menu')) {
    return
  }
  closeCrumbMenu()
}

function onWindowResize() {
  closeCrumbMenu()
}

function onWindowKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    closeCrumbMenu()
  }
}

onMounted(() => {
  document.addEventListener('pointerdown', onWindowPointerDown, true)
  document.addEventListener('scroll', onWindowScroll, true)
  window.addEventListener('resize', onWindowResize)
  document.addEventListener('keydown', onWindowKeydown)

  const el = breadcrumbScrollRef.value
  if (el) {
    breadcrumbResizeObserver = new ResizeObserver(() => {
      recomputeBreadcrumbFit()
    })
    breadcrumbResizeObserver.observe(el)
  }
  recomputeBreadcrumbFit()
})

onBeforeUnmount(() => {
  breadcrumbResizeObserver?.disconnect()
  breadcrumbResizeObserver = null
  document.removeEventListener('pointerdown', onWindowPointerDown, true)
  document.removeEventListener('scroll', onWindowScroll, true)
  window.removeEventListener('resize', onWindowResize)
  document.removeEventListener('keydown', onWindowKeydown)
})

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
      :class="{ 'has-overflow': hiddenPrefixCount > 0 && !measuring }"
      role="navigation"
      aria-label="Path"
      @click="onBreadcrumbBarClick"
    >
      <template v-if="segments.length">
        <template v-for="(seg, index) in segments" :key="seg.path">
          <span
            v-show="index >= hiddenPrefixCount || measuring"
            class="addr-crumb-wrap"
          >
            <button
              type="button"
              class="addr-crumb vgo-u-button-reset"
              :title="seg.path"
              @click.stop="onCrumbClick(seg.path)"
              @contextmenu.prevent.stop="showCrumbMenu(seg.path, $event)"
            >
              <span class="addr-crumb-text vgo-u-text-overflow">{{ seg.name }}</span>
            </button>
            <button
              v-if="index < segments.length - 1"
              type="button"
              class="addr-crumb-caret vgo-u-button-reset"
              :class="{ 'is-open': crumbMenu?.path === seg.path }"
              :title="`${seg.name} subfolders`"
              :aria-label="`${seg.name} subfolders`"
              :aria-expanded="crumbMenu?.path === seg.path"
              aria-haspopup="menu"
              @click.stop.prevent="onCrumbCaretClick(seg, $event)"
              @contextmenu.prevent.stop="showCrumbMenu(seg.path, $event)"
            >
              <span
                class="mdi"
                :class="crumbMenu?.path === seg.path ? 'mdi-chevron-down' : 'mdi-chevron-right'"
              />
            </button>
          </span>
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

    <Teleport to="body">
      <div
        v-if="crumbMenu"
        ref="crumbMenuRef"
        class="addr-crumb-menu vgo-panel vgo-u-scrollbar"
        :style="crumbMenuPanelStyle"
        role="menu"
        :aria-label="`${crumbMenu.name} subfolders`"
        tabindex="-1"
        @keydown="onMenuKeydown"
      >
        <div v-if="crumbMenuLoading" class="crumb-menu-status">
          Loading…
        </div>
        <template v-else>
          <button
            v-for="(dir, index) in crumbMenuSubDirs"
            :key="dir.name"
            type="button"
            role="menuitem"
            class="vgo-u-button-reset vgo-list-item crumb-menu-row"
            :class="{ 'is-active': menuActiveIndex === index }"
            :title="dir.name"
            @mouseenter="menuActiveIndex = index"
            @click="onMenuPick(dir)"
          >
            <span class="mdi mdi-folder crumb-menu-row-icon" />
            <span class="crumb-menu-row-name vgo-u-text-overflow">{{ dir.name }}</span>
          </button>
          <div v-if="!crumbMenuSubDirs.length" class="crumb-menu-status">
            {{ crumbMenuError ? 'Failed to load subfolders.' : 'No subfolders.' }}
          </div>
        </template>
      </div>
    </Teleport>
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
  overflow: hidden;

  @media screen and (max-width: $mq_mobile_width) {
    min-width: 120px;
  }
  padding: 0 var(--vgo-space-1);
  gap: 0;
  font-size: var(--vgo-font-md);
  cursor: text;

  // 溢出折叠时允许保留的末尾 crumb 收缩省略，而不是被裁掉
  &.has-overflow {
    .addr-crumb-wrap {
      flex-shrink: 1;
      min-width: 0;
    }

    .addr-crumb {
      flex-shrink: 1;
      min-width: 0;
    }
  }
}

.addr-crumb-wrap {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
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

.addr-crumb-caret {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: var(--vgo-icon-md);
  height: var(--vgo-icon-md);
  margin: 0 2px;
  border-radius: var(--vgo-radius);
  color: var(--vgo-text-secondary);
  line-height: 1;
  cursor: pointer;

  &:hover,
  &:focus-visible {
    background: var(--vgo-hover);
    color: var(--vgo-text);
  }

  &:focus-visible {
    outline: 1px solid var(--vgo-primary);
    outline-offset: -1px;
  }

  &.is-open {
    color: var(--vgo-primary);
    background-color: var(--vgo-primary-opacity);
  }

  .mdi {
    font-size: var(--vgo-icon-sm);
    line-height: 1;
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

.addr-crumb-menu {
  position: fixed;
  z-index: var(--vgo-z-overlay);
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  overflow-y: auto;
  padding: var(--vgo-space-1);
  outline: none;

  .crumb-menu-row {
    width: 100%;
    min-height: var(--vgo-control-md);
    padding-inline: var(--vgo-space-2);
    text-align: left;

    .crumb-menu-row-icon {
      flex-shrink: 0;
      color: var(--vgo-primary);
      font-size: var(--vgo-icon-md);
      line-height: 1;
    }

    .crumb-menu-row-name {
      flex: 1;
      min-width: 0;
      line-height: 1.4;
    }
  }

  .crumb-menu-status {
    padding: var(--vgo-space-3) var(--vgo-space-3);
    font-size: var(--vgo-font-sm);
    line-height: 1.6;
    text-align: center;
    color: var(--vgo-text-secondary);
  }
}
</style>
