<script lang="ts" setup>
import type { ImagePreviewCandidate } from './hooks/use-image-preview'
import type { IEntry } from '@/types/server.ts'
import { fsWebApi } from '@/api/filesystem.ts'
import { localSettingsStore, PREVIEW_SIZE_UNLIMITED } from '@/store/index.ts'
import { IMAGE_THUMB_SMALL_DIRECT_MAX } from '@/utils/image-thumb-cache'
import { regSupportedImageFormat } from '@/utils/is.ts'
import { normalizeListingPath } from '../utils'
import { getFileIconClass } from './file-icons'
import { applyFolderListSort, readFolderRawList } from './folder-listing'
import { useFolderImagePreviews, useImagePreview } from './hooks/use-image-preview'

const props = withDefaults(
  defineProps<{
    iconClass: string
    item?: IEntry
    absPath?: string
    iconSize?: number
  }>(),
  {
    iconSize: 48,
  },
)

const PREVIEW_LOAD_DEBOUNCE_MS = 100

const loadFailed = ref(false)
watch(
  () => props.absPath,
  () => {
    loadFailed.value = false
  },
)

// ---------------------------------------------------------------------------
// 文件预览候选：
// - 图片格式、非目录、图标尺寸 >= MIN_PREVIEW_ICON_SIZE、Preview Size 未 Disabled
//   才可能预览；小于该尺寸只显示类型图标，任何预览（含已有缓存）都不显示；
// - streamUrl 非空表示“允许下载原图”（未超 Preview Size 上限）；
// - 超出上限的大图也保留 cacheEnabled：命中已有缓存则直接显示（不下载原图），
//   未命中则不显示 —— 即「已有缓存时忽略 Preview Size 限制」。
// 实际的命中/生成/取消/回收逻辑在 hooks/use-image-preview.ts。
// ---------------------------------------------------------------------------
/** 图标小于该尺寸时不显示任何内容预览（图片预览 / 文件夹内容预览），只显示类型图标 */
const MIN_PREVIEW_ICON_SIZE = 48

const previewCandidate = computed<ImagePreviewCandidate | null>(() => {
  const { item, absPath, iconSize } = props
  if (!absPath || !item || item.isDirectory || !regSupportedImageFormat.test(item.name))
    return null
  if (iconSize < MIN_PREVIEW_ICON_SIZE)
    return null // 小于 48：不显示预览（含已有缓存），仅显示类型图标
  const previewSize = localSettingsStore.value.previewSize
  if (previewSize === 0)
    return null // Disabled：任何预览（含已有缓存）都不显示

  const itemSize = Number(item.size ?? 0)
  const lastModified = item.lastModified ?? 0
  const withinLimit = previewSize === PREVIEW_SIZE_UNLIMITED || itemSize <= previewSize
  const streamUrl = withinLimit ? fsWebApi.getStreamUrl(absPath) : ''
  const cacheEnabled = itemSize > IMAGE_THUMB_SMALL_DIRECT_MAX && lastModified > 0
  return { name: absPath, key: absPath, streamUrl, size: itemSize, lastModified, cacheEnabled }
})

// ---------------------------------------------------------------------------
// 预览图加载：可见 + 防抖；命中/生成/直连回退/取消由 useImagePreview 统一处理。
// ---------------------------------------------------------------------------

// 仅当元素可见时才加载预览图片
const target = useTemplateRef<HTMLDivElement>('target')
// const targetIsVisible = useElementVisibility(target as never, {
//   rootMargin: '500px 0px 500px 0px',
// })
const targetIsVisible = ref(true)

const { url: previewUrl, request: requestPreview, settle: settlePreview } = useImagePreview()
let previewDebounceTimer: ReturnType<typeof setTimeout> | null = null

function schedulePreviewCandidate(candidate: ImagePreviewCandidate | null) {
  if (previewDebounceTimer)
    clearTimeout(previewDebounceTimer)
  previewDebounceTimer = setTimeout(() => {
    previewDebounceTimer = null
    requestPreview(candidate)
  }, PREVIEW_LOAD_DEBOUNCE_MS)
}

watch(
  [previewCandidate, targetIsVisible, loadFailed],
  ([candidate, isVisible, failed]) => {
    schedulePreviewCandidate(isVisible && !failed ? candidate : null)
  },
  { immediate: true },
)

// ---------------------------------------------------------------------------
// 文件夹内容预览：iconSize >= 48 的目录，加载成功后用 CSS 圆角矩形边框
// 展示前 FOLDER_PREVIEW_MAX_ITEMS 个子项（图片子项缩略图 + 其余类型图标）。
// 图片子项同样按上述缓存规则解析（含“超出上限但有缓存则显示”）。
// 加载期间/空目录回退为普通文件夹图标。
// ---------------------------------------------------------------------------
const FOLDER_PREVIEW_MAX_ITEMS = 4
const FOLDER_PREVIEW_LOAD_DEBOUNCE_MS = 120

const folderPreviewEligible = computed(() => {
  const { item, absPath, iconSize } = props
  return !!item?.isDirectory && !item.error && !!absPath && iconSize >= MIN_PREVIEW_ICON_SIZE
})

const folderListingPath = computed(() =>
  folderPreviewEligible.value ? normalizeListingPath(props.absPath!) : '',
)

/** 该目录的原始列表；null 表示尚未加载完成（此时显示原文件夹图标） */
const folderRawList = ref<IEntry[] | null>(null)

const folderSortedItems = computed(() => {
  const raw = folderRawList.value
  if (!raw || !folderListingPath.value)
    return []
  return applyFolderListSort(folderListingPath.value, raw)
})

const folderPreviewItems = computed(() => folderSortedItems.value.slice(0, FOLDER_PREVIEW_MAX_ITEMS))

function buildChildPreviewCandidate(child: IEntry): ImagePreviewCandidate {
  const name = child.name
  const listingPath = folderListingPath.value
  const noImage = { name, key: '', streamUrl: '', size: 0, lastModified: 0, cacheEnabled: false }
  if (!listingPath || child.isDirectory || child.error || !regSupportedImageFormat.test(child.name))
    return noImage
  const previewSize = localSettingsStore.value.previewSize
  if (previewSize === 0)
    return noImage // Disabled：子项预览（含缓存）不显示，仍显示类型图标

  const size = Number(child.size ?? 0)
  const lastModified = child.lastModified ?? 0
  const fullPath = `${listingPath}${name}`
  const withinLimit = previewSize === PREVIEW_SIZE_UNLIMITED || size <= previewSize
  if (!withinLimit) {
    // 超出上限：仅当已有缓存时显示（cacheOnly）；未命中显示类型图标，不下载原图
    const cacheEnabled = size > IMAGE_THUMB_SMALL_DIRECT_MAX && lastModified > 0
    return { name, key: fullPath, streamUrl: '', size, lastModified, cacheEnabled }
  }
  // 限制内：大图未命中时生成，小图直连
  return {
    name,
    key: fullPath,
    streamUrl: fsWebApi.getStreamUrl(fullPath),
    size,
    lastModified,
    cacheEnabled: size > IMAGE_THUMB_SMALL_DIRECT_MAX && lastModified > 0,
  }
}

const folderPreviewCells = computed(() =>
  folderPreviewItems.value.map((child) => {
    return { child, candidate: buildChildPreviewCandidate(child) }
  }),
)

const {
  srcs: folderCellSrcs,
  failedNames: folderFailedNames,
  markError: markFolderCellError,
  reset: resetFolderPreviewCells,
} = useFolderImagePreviews(computed(() => folderPreviewCells.value.map(({ candidate }) => candidate)))

const folderPreviewFrameStyle = computed(() => {
  const size = props.iconSize
  const inset = Math.max(2, Math.round(size * 0.04))
  const gap = Math.max(2, Math.round(size * 0.04))
  return { padding: `${inset}px`, gap: `${gap}px` }
})

const folderMiniIconFontSize = computed(() => Math.max(10, Math.round(props.iconSize * 0.4)))

// 链接角标（左下角小图标）：随图标尺寸等比缩放，避免小图标下遮住整个字形
const linkBadgeSize = computed(() => {
  const size = props.iconSize
  return Math.min(18, Math.max(9, Math.round(size * 0.34)))
})
const linkBadgeStyle = computed(() => {
  const box = linkBadgeSize.value
  return {
    width: `${box}px`,
    height: `${box}px`,
    fontSize: `${Math.round(box * 0.8)}px`,
  }
})

let folderReadSeq = 0
let folderReadTimer: ReturnType<typeof setTimeout> | null = null

function scheduleFolderPreviewLoad() {
  if (folderReadTimer) {
    clearTimeout(folderReadTimer)
    folderReadTimer = null
  }
  const path = folderListingPath.value
  // 路径/条件变化先回退到原图标，加载完成后再展示内容
  folderRawList.value = null
  resetFolderPreviewCells()

  if (!path)
    return

  folderReadTimer = setTimeout(async () => {
    folderReadTimer = null
    const seq = ++folderReadSeq
    const raw = await readFolderRawList(path)
    if (folderReadSeq !== seq || folderListingPath.value !== path)
      return
    folderRawList.value = raw
  }, FOLDER_PREVIEW_LOAD_DEBOUNCE_MS)
}

watch(
  [folderPreviewEligible, () => props.absPath],
  () => scheduleFolderPreviewLoad(),
  { immediate: true },
)

onBeforeUnmount(() => {
  if (previewDebounceTimer)
    clearTimeout(previewDebounceTimer)
  if (folderReadTimer)
    clearTimeout(folderReadTimer)
  folderReadSeq += 1
})
</script>

<template>
  <div ref="target" class="themed-icon" :style="{ width: `${iconSize}px` }">
    <img
      v-if="previewUrl"
      class="preview-image"
      :src="previewUrl"
      @load="settlePreview"
      @error="() => {
        loadFailed = true
        settlePreview()
      }"
    >
    <span
      v-else-if="folderPreviewCells.length"
      class="folder-preview"
      :style="folderPreviewFrameStyle"
    >
      <span v-for="{ child } in folderPreviewCells" :key="child.name" class="folder-preview-cell">
        <img
          v-if="folderCellSrcs.has(child.name) && !folderFailedNames.includes(child.name)"
          class="folder-preview-thumb"
          :src="folderCellSrcs.get(child.name)"
          :alt="child.name"
          loading="lazy"
          @error="markFolderCellError(child.name)"
        >
        <span
          v-else
          class="folder-preview-child-icon"
          :style="{ fontSize: `${folderMiniIconFontSize}px` }"
        >
          <MdiIcon :name="getFileIconClass(child)" />
        </span>
      </span>
    </span>
    <span
      v-else-if="iconClass"
      class="themed-icon-class"
      :style="{ fontSize: `${iconSize}px` }"
    >
      <MdiIcon :name="iconClass" />
    </span>
    <span v-else class="themed-icon-class">
      <MdiIcon name="file-question" />
    </span>
    <span
      v-if="item?.isLink"
      class="themed-icon-link-badge"
      :style="linkBadgeStyle"
      aria-label="Link"
    >
      <i-mdi-link-variant />
    </span>
  </div>
</template>

<style lang="scss" scoped>
.themed-icon {
  display: inline-flex;
  align-content: center;
  justify-content: center;
  position: relative;
  width: 48px;
  aspect-ratio: 1;
  flex-shrink: 0;

  .preview-image {
    width: 100%;
    aspect-ratio: 1;
    object-fit: contain;
    //outline: 1px solid var(--vgo-primary);
  }

  .themed-icon-class {
    line-height: 1;
    color: var(--vgo-primary);
    &.abs-icon {
      position: absolute;
      right: 0;
      bottom: 0;
      font-size: var(--vgo-icon-sm) !important;
    }
  }

  // 文件夹内容预览：CSS 圆角矩形边框 + 2×2 子项内容。
  // 框架绝对定位铺满图标方框：子项（尤其是高>宽的图片缩略图）的固有尺寸
  // 不再参与布局，避免把容器高度撑开。
  .folder-preview {
    position: absolute;
    inset: 0;
    box-sizing: border-box;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    grid-template-rows: repeat(2, minmax(0, 1fr));
    align-items: stretch;
    justify-items: stretch;
    overflow: hidden;
    border: 2px solid var(--vgo-primary);
    border-radius: var(--vgo-radius);
  }

  .folder-preview-cell {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }

  // 缩略图脱离文档流铺满格子：无论图片固有比例如何都不会撑开格子高度
  .folder-preview-thumb {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
    object-fit: cover;
  }

  .folder-preview-child-icon {
    line-height: 1;
    color: var(--vgo-primary);
  }

  // 链接角标：显示在图标左下角
  .themed-icon-link-badge {
    position: absolute;
    left: 0;
    bottom: 0;
    z-index: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    border-radius: var(--vgo-radius);
    background-color: var(--vgo-primary);
    color: var(--vgo-on-primary);
    line-height: 1;
    pointer-events: none;
  }
}
</style>
