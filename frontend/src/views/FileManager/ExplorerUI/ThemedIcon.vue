<script lang="ts" setup>
import type { ImagePreviewCandidate } from './hooks/use-image-preview'
import type { IEntry } from '@/types/server.ts'
import { useElementVisibility } from '@vueuse/core'
import { fsWebApi } from '@/api/filesystem.ts'
import { serverCapabilities } from '@/store/capabilities'
import { localSettingsStore } from '@/store/index.ts'
import { IMAGE_PREVIEW_RAW_MAX_BYTES, IMAGE_THUMB_MAX_EDGE, IMAGE_THUMB_SMALL_DIRECT_MAX } from '@/utils/image-thumb-cache'
import { regClientCanvasThumbFormat, regServerThumbFormat, regSupportedAudioFormat, regSupportedImageFormat, regSupportedVideoFormat } from '@/utils/is.ts'
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
// - 图片格式、非目录、图标尺寸 >= MIN_PREVIEW_ICON_SIZE 才可能预览，
//   小于该尺寸只显示类型图标（含已有缓存）；
// - 取图方式由 `mode` 决定，见 buildImagePreviewCandidate：
//   `server` 走后端缩略图接口、`client` 走前端 canvas 降采样（都进 IndexedDB），
//   其余的矢量 / 图标容器与所有小图 `direct` 直连原图流。
// 实际的命中/生成/取消/回收逻辑在 hooks/use-image-preview.ts。
// ---------------------------------------------------------------------------
/** 图标小于该尺寸时不显示任何内容预览（图片预览 / 文件夹内容预览），只显示类型图标 */
const MIN_PREVIEW_ICON_SIZE = 48

/**
 * iconSize 只通过这个**布尔量**参与候选计算的依赖：grid 尺寸是个连续拖拽的
 * el-slider（48→512, step 8），而 Element Plus 滑块的 debounce 只管 tooltip，
 * v-model 每动一格就更新。若让候选直接依赖 iconSize，拖拽时每个图标每动一格
 * 都会重建候选对象，进而触发一次「IDB 读 → createObjectURL → revoke」。
 * 布尔量在拖拽过程中值不变，computed 不会向下游传播。
 */
const previewSizeAllowed = computed(() => props.iconSize >= MIN_PREVIEW_ICON_SIZE)

/**
 * 用户可以在菜单里整体关掉内容预览（仅存本机）。
 * 关掉后连文件夹内容预览一起不显示 —— 它同样是「预览」。
 */
const previewDisabled = computed(() => localSettingsStore.value.disablePreview)

/** 这三类文件才可能出内容预览（图片 / 音频封面 / 视频封面） */
function isPreviewableName(name: string) {
  return regSupportedImageFormat.test(name)
    || regSupportedAudioFormat.test(name)
    || regSupportedVideoFormat.test(name)
}

/**
 * 文件夹 2×2 格子用的更窄集合：**不含视频**。
 * 每个格子都要单独起一次 ffmpeg，而一屏可能有几十个文件夹（×4 格），
 * 挤在只有 1 个槽位的视频闸门上会互相拖垮。视频封面只在单文件预览里出。
 */
function isFolderCellPreviewableName(name: string) {
  return regSupportedImageFormat.test(name) || regSupportedAudioFormat.test(name)
}

/**
 * 决定一个文件用哪种方式取预览：
 * - 图片（后端能解码）且超过小图阈值 → `server`：后端缩略图接口；
 * - 图片（后端解不了，avif/heic/heif）且超过阈值 → `client`：canvas 降采样；
 * - 音频 → `audio`：前端从内嵌标签抽封面（不需要后端能力）；
 * - 视频 → `server` + `kind=video`（需要后端 ffmpeg 能力，否则压根不请求）；
 * - 其余（svg/ico 等矢量与图标容器、以及所有小图）→ `direct`：直连原图流，不入缓存。
 *
 * 后端解不了的格式走 canvas 有一个例外：svg/ico 永远是 `direct`。
 * 它们本来就小，而且 createImageBitmap 对没有固有尺寸的 SVG 会直接抛错。
 *
 * 另外，后端白名单之外的图片必须由前端自己下载原图，因此受
 * IMAGE_PREVIEW_RAW_MAX_BYTES 约束，超限直接不出预览（显示类型图标）。
 */
function buildPreviewCandidate(item: IEntry, absPath: string, name: string): ImagePreviewCandidate | null {
  if (!absPath)
    return null

  const size = Number(item.size ?? 0)
  const lastModified = item.lastModified ?? 0
  const streamUrl = fsWebApi.getStreamUrl(absPath)
  // 指纹必须有 lastModified：没有它就没法判断文件变没变，不值得入缓存
  const fingerprintable = lastModified > 0
  const smallImage = size <= IMAGE_THUMB_SMALL_DIRECT_MAX || !fingerprintable

  if (regSupportedImageFormat.test(item.name)) {
    if (regServerThumbFormat.test(item.name)) {
      if (smallImage)
        return { name, key: absPath, mode: 'direct', url: streamUrl, size, lastModified }
      return {
        name,
        key: absPath,
        mode: 'server',
        url: fsWebApi.getThumbnailUrl(absPath, IMAGE_THUMB_MAX_EDGE, lastModified),
        fallbackUrl: streamUrl,
        size,
        lastModified,
      }
    }

    // 以下格式都要前端自己拉原图（canvas 降采样或直连），超出上限一律不出预览
    if (size > IMAGE_PREVIEW_RAW_MAX_BYTES)
      return null

    if (regClientCanvasThumbFormat.test(item.name) && !smallImage)
      return { name, key: absPath, mode: 'client', url: streamUrl, size, lastModified }

    return { name, key: absPath, mode: 'direct', url: streamUrl, size, lastModified }
  }

  // 音频封面由前端解析内嵌标签，不依赖任何后端能力
  if (regSupportedAudioFormat.test(item.name)) {
    if (!fingerprintable)
      return null
    return { name, key: absPath, mode: 'audio', url: streamUrl, size, lastModified }
  }

  // 视频封面必须由后端 ffmpeg 出；能力没开就不出预览。
  // 注意这里**不给 fallbackUrl**：失败时只能显示类型图标，
  // 不能为了一个网格格子去把整部影片下下来。
  if (regSupportedVideoFormat.test(item.name)) {
    if (!fingerprintable || !serverCapabilities.value.videoThumbnail)
      return null
    return {
      name,
      key: absPath,
      mode: 'server',
      url: fsWebApi.getThumbnailUrl(absPath, IMAGE_THUMB_MAX_EDGE, lastModified, 'video'),
      size,
      lastModified,
    }
  }

  return null
}

const previewCandidate = computed<ImagePreviewCandidate | null>(() => {
  const { item, absPath } = props
  if (!absPath || !item || item.isDirectory || !isPreviewableName(item.name))
    return null
  if (previewDisabled.value)
    return null

  return buildPreviewCandidate(item, absPath, absPath)
})

// ---------------------------------------------------------------------------
// 预览图加载：可见 + 防抖；命中/生成/直连回退/取消由 useImagePreview 统一处理。
// ---------------------------------------------------------------------------

// 仅当元素可见时才加载预览图片。用视口作为 root：IntersectionObserver 的
// 交叉区域会先被各级滚动容器裁剪，所以网格的纵向滚动与缩略图条的横向滚动
// 都能正确判定“滚出视野 = 不加载”；rootMargin 只给纵向预加载留余量。
const PREVIEW_LOAD_ROOT_MARGIN = '300px 0px 300px 0px'

const target = useTemplateRef<HTMLDivElement>('target')
const targetIsVisible = useElementVisibility(target, {
  rootMargin: PREVIEW_LOAD_ROOT_MARGIN,
})

const { url: previewUrl, request: requestPreview, settle: settlePreview } = useImagePreview()
let previewDebounceTimer: ReturnType<typeof setTimeout> | null = null

function cancelPendingPreview() {
  if (previewDebounceTimer) {
    clearTimeout(previewDebounceTimer)
    previewDebounceTimer = null
  }
}

/**
 * 只有「已经可见、候选又变了」才值得防抖：那种情况往往成串发生（目录刷新、
 * 排序变化），防抖能把它们合并成一次解析。
 *
 * 其余两种都立即执行：
 * - 取消（滚出视野 / 加载失败 / 图标尺寸落到 48 以下）—— 越早 abort 越省；
 * - 首次可见 —— 全局队列（preview-load-queue）已经限了并发，
 *   再等一个 debounce 周期只是白白推迟首次出图。
 */
function applyPreviewCandidate(candidate: ImagePreviewCandidate | null, immediate: boolean) {
  cancelPendingPreview()

  if (immediate) {
    requestPreview(candidate)
    return
  }

  previewDebounceTimer = setTimeout(() => {
    previewDebounceTimer = null
    requestPreview(candidate)
  }, PREVIEW_LOAD_DEBOUNCE_MS)
}

watch(
  [previewCandidate, targetIsVisible, loadFailed, previewSizeAllowed],
  ([candidate, isVisible, failed, sizeAllowed], old) => {
    const next = isVisible && !failed && sizeAllowed ? candidate : null
    const wasActive = !!old && old[1] && !old[2] && old[3]
    applyPreviewCandidate(next, next === null || !wasActive)
  },
  { immediate: true },
)

// ---------------------------------------------------------------------------
// 文件夹内容预览：iconSize >= 48 的目录，加载成功后用 CSS 圆角矩形边框
// 展示前 FOLDER_PREVIEW_MAX_ITEMS 个子项（图片子项缩略图 + 其余类型图标）。
// 图片子项按与主预览相同的 mode 规则解析。
// 加载期间/空目录回退为普通文件夹图标。
// ---------------------------------------------------------------------------
const FOLDER_PREVIEW_MAX_ITEMS = 4
const FOLDER_PREVIEW_LOAD_DEBOUNCE_MS = 120

const folderPreviewEligible = computed(() => {
  const { item, absPath } = props
  return !!item?.isDirectory && !item.error && !!absPath
    && previewSizeAllowed.value && !previewDisabled.value
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

/** 该子项不参与预览（非图片 / 不可预览）时的占位：key 为空，hook 会跳过 */
function emptyChildCandidate(name: string): ImagePreviewCandidate {
  return { name, key: '', mode: 'direct', url: '', size: 0, lastModified: 0 }
}

function buildChildPreviewCandidate(child: IEntry): ImagePreviewCandidate {
  const name = child.name
  const listingPath = folderListingPath.value
  if (!previewSizeAllowed.value || !listingPath || child.isDirectory || child.error || !isFolderCellPreviewableName(child.name))
    return emptyChildCandidate(name)

  return buildPreviewCandidate(child, `${listingPath}${name}`, name) ?? emptyChildCandidate(name)
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

// 角标（右下角类型 / 左下角链接）：随图标尺寸等比缩放，避免小图标下遮住整个字形
const badgeSize = computed(() => {
  const size = props.iconSize
  return Math.min(18, Math.max(9, Math.round(size * 0.34)))
})
function badgeBoxStyle(box: number) {
  return {
    width: `${box}px`,
    height: `${box}px`,
    fontSize: `${Math.round(box * 0.8)}px`,
  }
}
const linkBadgeStyle = computed(() => badgeBoxStyle(badgeSize.value))
const typeBadgeStyle = computed(() => badgeBoxStyle(badgeSize.value))

/**
 * 非图片文件出预览时，在右下角压一个类型图标：
 * 缩略图本身看不出这是音频还是视频，角标用来区分文件类型。
 * 图片不加（对图片而言类型没有区分价值），文件夹 2×2 预览也不加（格子太小看不清）。
 */
const typeBadgeIcon = computed(() => props.iconClass || getFileIconClass(props.item))
const showTypeBadge = computed(() =>
  !!previewUrl.value && !!props.item && !regSupportedImageFormat.test(props.item.name),
)

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
  cancelPendingPreview()
  if (folderReadTimer)
    clearTimeout(folderReadTimer)
  folderReadSeq += 1
})
</script>

<template>
  <div ref="target" class="themed-icon" :style="{ width: `${iconSize}px`, height: `${iconSize}px` }">
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
      v-if="showTypeBadge"
      class="themed-icon-type-badge"
      :style="typeBadgeStyle"
      aria-hidden="true"
    >
      <MdiIcon :name="typeBadgeIcon" />
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

  // 右下角类型角标：音频 / 视频出了封面之后，光看缩略图分不出是什么文件类型。
  // 放在右下角，和左下角的链接角标错开。
  .themed-icon-type-badge {
    position: absolute;
    right: 0;
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
