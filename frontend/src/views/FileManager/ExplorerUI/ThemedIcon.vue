<script lang="ts" setup>
import type { IEntry } from '@/types/server.ts'
import { fsWebApi } from '@/api/filesystem.ts'
import { localSettingsStore, PREVIEW_SIZE_UNLIMITED } from '@/store/index.ts'
import { regSupportedImageFormat } from '@/utils/is.ts'
import { normalizeListingPath } from '../utils'
import { getFileIconClass } from './file-icons'
import { applyFolderListSort, readFolderRawList } from './folder-listing'
import { requestPreviewLoad } from './preview-load-queue'

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
const previewSrc = computed(() => {
  const { item, absPath, iconSize } = props
  const previewSize = localSettingsStore.value.previewSize
  const itemSize = Number(item?.size ?? 0)
  if (absPath && item) {
    // 仅支持图片预览，且大小不超过配置上限
    const withinConfigLimit = previewSize !== 0 && (previewSize === PREVIEW_SIZE_UNLIMITED || itemSize <= previewSize)
    // 小图标时只对足够小的文件生成预览
    const smallIconWithinLimit = iconSize >= 48 || itemSize < 500 * 1024
    if (
      withinConfigLimit
      && smallIconWithinLimit
      && !item.isDirectory
      && regSupportedImageFormat.test(item.name)
    ) {
      return fsWebApi.getStreamUrl(absPath)
    }
  }
  return ''
})

// 仅当元素可见时才加载预览图片
const target = useTemplateRef<HTMLDivElement>('target')
// const targetIsVisible = useElementVisibility(target as never, {
//   rootMargin: '500px 0px 500px 0px',
// })
const targetIsVisible = ref(true)

const queuedPreviewSrc = ref('')
let stopPreviewLoad: (() => void) | null = null
let previewLoadDebounceTimer: ReturnType<typeof setTimeout> | null = null

function stopCurrentPreviewLoad() {
  stopPreviewLoad?.()
  stopPreviewLoad = null
  queuedPreviewSrc.value = ''
}

function schedulePreviewLoad(src: string) {
  if (previewLoadDebounceTimer)
    clearTimeout(previewLoadDebounceTimer)

  previewLoadDebounceTimer = setTimeout(() => {
    previewLoadDebounceTimer = null
    stopCurrentPreviewLoad()

    if (!src)
      return

    stopPreviewLoad = requestPreviewLoad(() => {
      queuedPreviewSrc.value = src
    })
  }, PREVIEW_LOAD_DEBOUNCE_MS)
}

function finishCurrentPreviewLoad() {
  stopPreviewLoad?.()
  stopPreviewLoad = null
}

watch(
  [previewSrc, targetIsVisible, loadFailed],
  ([src, isVisible, failed]) => {
    schedulePreviewLoad(src && isVisible && !failed ? src : '')
  },
  { immediate: true },
)

// ---------------------------------------------------------------------------
// 文件夹内容预览：iconSize >= 48 的目录，加载成功后用 CSS 圆角矩形边框
// 展示前 FOLDER_PREVIEW_MAX_ITEMS 个子项（图片子项缩略图 + 其余类型图标）。
// 加载期间/空目录回退为普通文件夹图标。
// ---------------------------------------------------------------------------
const FOLDER_PREVIEW_MIN_ICON_SIZE = 48
const FOLDER_PREVIEW_MAX_ITEMS = 4
const FOLDER_PREVIEW_LOAD_DEBOUNCE_MS = 120

const folderPreviewEligible = computed(() => {
  const { item, absPath, iconSize } = props
  return !!item?.isDirectory && !item.error && !!absPath && iconSize >= FOLDER_PREVIEW_MIN_ICON_SIZE
})

const folderListingPath = computed(() =>
  folderPreviewEligible.value ? normalizeListingPath(props.absPath!) : '',
)

/** 该目录的原始列表；null 表示尚未加载完成（此时显示原文件夹图标） */
const folderRawList = ref<IEntry[] | null>(null)
const failedThumbNames = ref<string[]>([])

const folderSortedItems = computed(() => {
  const raw = folderRawList.value
  if (!raw || !folderListingPath.value)
    return []
  return applyFolderListSort(folderListingPath.value, raw)
})

const folderPreviewItems = computed(() => folderSortedItems.value.slice(0, FOLDER_PREVIEW_MAX_ITEMS))

const folderPreviewCells = computed(() =>
  folderPreviewItems.value.map((child) => {
    return { child, src: getChildThumbUrl(child) }
  }),
)

const folderPreviewFrameStyle = computed(() => {
  const size = props.iconSize
  const inset = Math.max(2, Math.round(size * 0.04))
  const gap = Math.max(2, Math.round(size * 0.04))
  return { padding: `${inset}px`, gap: `${gap}px` }
})

const folderMiniIconFontSize = computed(() => Math.max(10, Math.round(props.iconSize * 0.4)))

function canChildUseImageThumb(child: IEntry) {
  if (child.isDirectory || child.error)
    return false
  const previewSize = localSettingsStore.value.previewSize
  if (previewSize === 0)
    return false
  const size = Number(child.size ?? 0)
  if (previewSize !== PREVIEW_SIZE_UNLIMITED && size > previewSize)
    return false
  return regSupportedImageFormat.test(child.name)
}

function getChildThumbUrl(child: IEntry) {
  if (!folderListingPath.value || !canChildUseImageThumb(child))
    return ''
  return fsWebApi.getStreamUrl(`${folderListingPath.value}${child.name}`)
}

function onChildThumbError(child: IEntry) {
  if (!failedThumbNames.value.includes(child.name)) {
    failedThumbNames.value = [...failedThumbNames.value, child.name]
  }
}

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
  failedThumbNames.value = []

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
  if (previewLoadDebounceTimer)
    clearTimeout(previewLoadDebounceTimer)
  if (folderReadTimer)
    clearTimeout(folderReadTimer)
  folderReadSeq += 1
  stopCurrentPreviewLoad()
})
</script>

<template>
  <div ref="target" class="themed-icon" :style="{ width: `${iconSize}px` }">
    <img
      v-if="queuedPreviewSrc"
      class="preview-image"
      :src="queuedPreviewSrc"
      @load="finishCurrentPreviewLoad"
      @error="() => {
        loadFailed = true
        finishCurrentPreviewLoad()
      }"
    >
    <span
      v-else-if="folderPreviewCells.length"
      class="folder-preview"
      :style="folderPreviewFrameStyle"
    >
      <span v-for="{ child, src } in folderPreviewCells" :key="child.name" class="folder-preview-cell">
        <img
          v-if="src && !failedThumbNames.includes(child.name)"
          class="folder-preview-thumb"
          :src="src"
          :alt="child.name"
          loading="lazy"
          @error="onChildThumbError(child)"
        >
        <span
          v-else
          class="folder-preview-child-icon"
          :class="`mdi ${getFileIconClass(child)}`"
          :style="{ fontSize: `${folderMiniIconFontSize}px` }"
        />
      </span>
    </span>
    <span
      v-else-if="iconClass"
      class="themed-icon-class"
      :class="[iconClass]"
      :style="{ fontSize: `${iconSize}px` }"
    />
    <span v-else class="themed-icon-class mdi mdi-file-question" />
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

  // 文件夹内容预览：CSS 圆角矩形边框 + 2×2 子项内容
  .folder-preview {
    width: 100%;
    height: 100%;
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
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }

  .folder-preview-thumb {
    width: 100%;
    height: 100%;
    display: block;
    object-fit: cover;
  }

  .folder-preview-child-icon {
    line-height: 1;
    color: var(--vgo-primary);
  }
}
</style>
