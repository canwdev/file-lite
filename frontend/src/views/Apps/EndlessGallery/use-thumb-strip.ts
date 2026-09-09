/**
 * 底部缩略图导航条 —— 窗口化渲染 / 自动居中 / 下标进度 / 滚轮与触摸横向滚动。
 *
 * 与 GalleryThumbStrip.vue 配套：
 * - 只渲染可视区（含 overscan 余量）内的格子，未渲染的部分用 sizer 的左右内边距占位，
 *   所以滚动宽度、原生滚动条和几何计算与全量渲染完全一致（几千项目录不再一次性挂载）；
 * - 当前项变化（键盘、滚轮、拖拽、点击缩略图）后把对应格子滚到轨道中间；
 * - 进度 = (当前下标 + 1) / 总数，由组件的半透明主题色背景层呈现（不是滚动位置）；
 * - 轨道上的滚轮映射为横向滚动，不触发图片切换（由模板的 .stop.prevent 拦下）。
 */
import type { Ref } from 'vue'
import type { MediaFile } from './use-media-list.ts'

/** 缩略图尺寸；ThemedIcon 小于 48px 只显示类型图标（MIN_PREVIEW_ICON_SIZE），不能更小 */
export const THUMB_ICON_SIZE = 48

/** 可视区两侧额外渲染的像素余量（约一个视口，保证滚动时不出现空白） */
const OVERSCAN_PX = 480
/** 超过这么多个视口宽度的跳转直接瞬时滚动，避免动画期间反复挂载/卸载缩略图 */
const INSTANT_JUMP_VIEWPORTS = 2
/** 首帧测量前的兜底几何：48 + 格子内边距 4×2 */
const FALLBACK_CELL_SIZE = THUMB_ICON_SIZE + 8
const FALLBACK_GAP = 4
const FALLBACK_TRACK_PADDING = 8

interface UseThumbStripOptions {
  items: Ref<MediaFile[]>
  currentIndex: Ref<number>
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function useThumbStrip({ items, currentIndex }: UseThumbStripOptions) {
  const trackRef = ref<HTMLElement | null>(null)

  // ── 几何 ───────────────────────────────────────────────────
  // 挂载 / 尺寸变化 / 列表变化时从真实 DOM 量一次，避免在 JS 里硬编码 vgo 间距 token。
  const cellSize = ref(FALLBACK_CELL_SIZE)
  /** 相邻两个格子左边缘的距离（格子宽 + 间距）；只有一个格子时退化为 宽 + gap */
  const stride = ref(FALLBACK_CELL_SIZE + FALLBACK_GAP)
  const trackPadding = ref(FALLBACK_TRACK_PADDING)

  // ── 窗口状态 ───────────────────────────────────────────────
  const scrollLeft = ref(0)
  const viewportWidth = ref(0)

  const startIndex = computed(() => {
    const total = items.value.length
    if (!total || stride.value <= 0)
      return 0
    const first = Math.floor((scrollLeft.value - trackPadding.value - OVERSCAN_PX) / stride.value)
    return clamp(first, 0, total)
  })

  const endIndex = computed(() => {
    const total = items.value.length
    if (!total || stride.value <= 0)
      return 0
    const last = Math.ceil((scrollLeft.value - trackPadding.value + viewportWidth.value + OVERSCAN_PX) / stride.value)
    return clamp(last, startIndex.value, total)
  })

  const visibleItems = computed(() =>
    items.value.slice(startIndex.value, endIndex.value).map((item, offset) => ({
      item,
      index: startIndex.value + offset,
    })),
  )

  // 未渲染项用 sizer 的左右内边距占位：sizer 宽度 = (n-1)*stride + cellSize，与原布局一致
  const sizerStyle = computed(() => ({
    paddingLeft: `${startIndex.value * stride.value}px`,
    paddingRight: `${(items.value.length - endIndex.value) * stride.value}px`,
  }))

  /** 当前图片在列表中的位置，0%~100% */
  const progressWidth = computed(() => {
    const total = items.value.length
    if (!total)
      return '0%'
    return `${((currentIndex.value + 1) / total * 100).toFixed(2)}%`
  })

  // ── 测量 ───────────────────────────────────────────────────

  function measure(): void {
    const track = trackRef.value
    if (!track)
      return

    const trackStyle = getComputedStyle(track)
    const padding = Number.parseFloat(trackStyle.paddingLeft)
    if (Number.isFinite(padding))
      trackPadding.value = padding

    const cells = track.querySelectorAll<HTMLElement>('.thumb-strip__cell')
    const firstCell = cells[0]
    if (firstCell?.offsetWidth)
      cellSize.value = firstCell.offsetWidth

    if (cells.length >= 2) {
      // 直接量步长：与 CSS 的格子宽度/间距完全一致，不依赖 token 数值
      const measured = cells[1].offsetLeft - firstCell.offsetLeft
      if (measured > 0)
        stride.value = measured
    }
    else {
      const sizer = track.querySelector<HTMLElement>('.thumb-strip__sizer')
      const gap = sizer ? Number.parseFloat(getComputedStyle(sizer).columnGap) : Number.NaN
      stride.value = cellSize.value + (Number.isFinite(gap) ? gap : FALLBACK_GAP)
    }

    viewportWidth.value = track.clientWidth
    scrollLeft.value = track.scrollLeft
  }

  // ── 滚动 ───────────────────────────────────────────────────

  let scrollRaf = 0
  function onTrackScroll(): void {
    if (scrollRaf)
      return
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = 0
      const track = trackRef.value
      if (!track)
        return
      scrollLeft.value = track.scrollLeft
      viewportWidth.value = track.clientWidth
    })
  }

  function scrollLeftForIndex(index: number): number {
    const track = trackRef.value
    const viewport = track?.clientWidth ?? viewportWidth.value
    const center = trackPadding.value + index * stride.value + cellSize.value / 2
    const raw = Math.max(0, center - viewport / 2)
    // 自己先按可滚动上限夹紧：首尾项居中会超出范围，浏览器夹紧后的实际位置若与
    // 这里记录的值相差超过 overscan，窗口就会渲染到可视区之外（出现空白）。
    const max = track ? Math.max(0, track.scrollWidth - track.clientWidth) : Number.POSITIVE_INFINITY
    return Math.min(raw, max)
  }

  function scrollToIndex(index: number, behavior: ScrollBehavior): void {
    const track = trackRef.value
    if (!track)
      return

    const left = scrollLeftForIndex(index)
    track.scrollTo({ left, behavior })

    if (behavior === 'auto') {
      // 与 DOM 滚动在同一个 tick 内同步窗口状态，跳到远处时不会先渲染错误的窗口
      scrollLeft.value = left
      viewportWidth.value = track.clientWidth
    }
  }

  /** 当前项变化：在窗口内则平滑滚动，跨窗口跳转直接瞬时 */
  function centerCurrent(): void {
    const track = trackRef.value
    if (!track)
      return

    const index = currentIndex.value
    const inWindow = index >= startIndex.value && index < endIndex.value
    const left = scrollLeftForIndex(index)
    const tooFar = Math.abs(left - track.scrollLeft) > track.clientWidth * INSTANT_JUMP_VIEWPORTS
    scrollToIndex(index, inWindow && !tooFar ? 'smooth' : 'auto')
  }

  // ── 滚轮 / 触摸 ────────────────────────────────────────────

  function onTrackWheel(e: WheelEvent): void {
    const track = trackRef.value
    if (!track)
      return
    track.scrollLeft += e.deltaX + e.deltaY
  }

  // 触摸横向拖动：gallery 根节点的 touch-action: none 会与轨道的 pan-x 取交集，
  // 原生触摸滚动被禁用，所以这里手动平移（只有明确是横向手势才接管，轻点仍是点击）。
  const TOUCH_PAN_THRESHOLD = 4
  let touchStartX = 0
  let touchStartY = 0
  let touchStartScrollLeft = 0
  let touchPanActive = false

  function cleanTouchPanListeners(): void {
    window.removeEventListener('touchmove', onTouchPanMove)
    window.removeEventListener('touchend', onTouchPanEnd)
    window.removeEventListener('touchcancel', onTouchPanEnd)
  }

  function onTouchPanMove(e: TouchEvent): void {
    const track = trackRef.value
    const touch = e.touches[0]
    if (!track || !touch)
      return

    const dx = touch.clientX - touchStartX
    const dy = touch.clientY - touchStartY
    if (!touchPanActive) {
      if (Math.abs(dx) < TOUCH_PAN_THRESHOLD || Math.abs(dx) <= Math.abs(dy))
        return
      touchPanActive = true
    }

    e.preventDefault()
    track.scrollLeft = touchStartScrollLeft - dx
  }

  function onTouchPanEnd(): void {
    touchPanActive = false
    cleanTouchPanListeners()
  }

  function onTrackTouchStart(e: TouchEvent): void {
    const track = trackRef.value
    const touch = e.touches[0]
    if (!track || !touch || e.touches.length !== 1)
      return

    touchStartX = touch.clientX
    touchStartY = touch.clientY
    touchStartScrollLeft = track.scrollLeft
    touchPanActive = false
    window.addEventListener('touchmove', onTouchPanMove, { passive: false })
    window.addEventListener('touchend', onTouchPanEnd)
    window.addEventListener('touchcancel', onTouchPanEnd)
  }

  // ── 生命周期 ───────────────────────────────────────────────

  let resizeObserver: ResizeObserver | undefined

  watch(currentIndex, () => centerCurrent())

  // 列表身份变化（换目录 / 换列表）：重测几何并立刻回到当前项，不做平滑滚动
  watch(items, () => {
    void nextTick(() => {
      measure()
      scrollToIndex(currentIndex.value, 'auto')
    })
  })

  onMounted(() => {
    const track = trackRef.value
    if (!track)
      return

    measure()
    scrollToIndex(currentIndex.value, 'auto')

    // scroll 由模板的 @scroll.passive 监听；这里只跟随轨道尺寸变化重测几何
    resizeObserver = new ResizeObserver(() => {
      measure()
    })
    resizeObserver.observe(track)
  })

  onBeforeUnmount(() => {
    cleanTouchPanListeners()
    resizeObserver?.disconnect()
    if (scrollRaf) {
      cancelAnimationFrame(scrollRaf)
      scrollRaf = 0
    }
  })

  return {
    trackRef,
    visibleItems,
    sizerStyle,
    progressWidth,
    onTrackScroll,
    onTrackWheel,
    onTrackTouchStart,
  }
}
