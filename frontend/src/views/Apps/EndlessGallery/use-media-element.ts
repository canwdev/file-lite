/**
 * 单个音视频元素的状态机 —— 供 GalleryMedia.vue 使用。
 *
 * - 元素由组件的 v-if 控制：不是当前槽位就不存在（src 随之释放），
 *   所以这里所有操作都容忍 elRef 为空；
 * - 点击 / 拖拽的区分在组件层（surface 上按下与抬起的位移），
 *   与 use-swipe 的翻页阈值互不干扰；
 * - 静音状态与播放位置都是会话级共享：静音跨文件保持，位置按 url 记忆。
 */
import type { MediaFile } from './use-media-list.ts'

/** 会话内记忆每个文件的播放位置（秒）；刷新页面即丢失 */
const resumePositions = new Map<string, number>()
/** 静音状态在画廊内全局共享，默认静音 */
const muted = ref(true)

/** 位移小于该值、时长小于 TAP_MAX_DURATION 才算点击（否则是翻页拖拽） */
const TAP_MAX_DISTANCE = 8
const TAP_MAX_DURATION = 300

interface UseMediaElementOptions {
  item: () => MediaFile | null
  /** 是否是当前槽位；false 时媒体元素已被卸载 */
  active: () => boolean
}

export function useMediaElement({ item, active }: UseMediaElementOptions) {
  const elRef = ref<HTMLMediaElement | null>(null)
  const seekBarRef = ref<HTMLElement | null>(null)

  const isReady = ref(false)
  const isPlaying = ref(false)
  const isScrubbing = ref(false)
  const progressPercent = ref(0)
  const scrubPercent = ref(0)

  /** 拖动中显示拖动值，否则显示真实进度 */
  const displayPercent = computed(() =>
    `${(isScrubbing.value ? scrubPercent.value : progressPercent.value).toFixed(2)}%`,
  )

  /** 当前元素对应的 url（切项时先存旧位置再更新它） */
  let boundUrl = ''

  function getDuration(el: HTMLMediaElement): number {
    return Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 0
  }

  function savePosition(): void {
    const el = elRef.value
    if (el && boundUrl && el.currentTime > 0)
      resumePositions.set(boundUrl, el.currentTime)
  }

  function resetDisplay(): void {
    isReady.value = false
    isPlaying.value = false
    isScrubbing.value = false
    progressPercent.value = 0
    scrubPercent.value = 0
  }

  function updateProgress(el: HTMLMediaElement): void {
    const duration = getDuration(el)
    progressPercent.value = duration
      ? Math.min(100, Math.max(0, el.currentTime / duration * 100))
      : 0
  }

  async function play(el: HTMLMediaElement): Promise<void> {
    try {
      await el.play()
    }
    catch {
      // 自动播放被拦截 / 解码失败：保持暂停态，等用户点击
    }
  }

  function onLoadedMetadata(e: Event): void {
    const el = e.target as HTMLMediaElement
    isReady.value = true

    const resume = resumePositions.get(boundUrl) ?? 0
    const duration = getDuration(el)
    if (resume > 0 && (!duration || resume < duration - 1))
      el.currentTime = resume

    updateProgress(el)
    void play(el)
  }

  function onTimeUpdate(e: Event): void {
    updateProgress(e.target as HTMLMediaElement)
  }

  function onPlay(): void {
    isPlaying.value = true
  }

  function onPause(): void {
    isPlaying.value = false
    savePosition()
  }

  async function togglePlay(): Promise<void> {
    const el = elRef.value
    if (!el)
      return
    if (el.paused)
      await play(el)
    else
      el.pause()
  }

  function toggleMute(): void {
    muted.value = !muted.value
  }

  // ── 点击（与拖拽翻页区分）─────────────────────────────────

  let tapStartX = 0
  let tapStartY = 0
  let tapStartAt = 0

  function onSurfacePointerDown(e: PointerEvent): void {
    tapStartX = e.clientX
    tapStartY = e.clientY
    tapStartAt = Date.now()
  }

  function onSurfacePointerUp(e: PointerEvent): void {
    if (!tapStartAt)
      return
    const distance = Math.hypot(e.clientX - tapStartX, e.clientY - tapStartY)
    const elapsed = Date.now() - tapStartAt
    tapStartAt = 0
    if (distance <= TAP_MAX_DISTANCE && elapsed <= TAP_MAX_DURATION)
      void togglePlay()
  }

  // ── 拖拽 seek ─────────────────────────────────────────────

  function ratioFromEvent(e: PointerEvent): number {
    const bar = seekBarRef.value
    if (!bar)
      return 0
    const rect = bar.getBoundingClientRect()
    if (rect.width <= 0)
      return 0
    return Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
  }

  function applySeek(e: PointerEvent): void {
    const el = elRef.value
    const duration = el ? getDuration(el) : 0
    if (!el || !duration)
      return

    const ratio = ratioFromEvent(e)
    scrubPercent.value = ratio * 100
    progressPercent.value = scrubPercent.value
    el.currentTime = ratio * duration
  }

  function onSeekPointerDown(e: PointerEvent): void {
    const el = elRef.value
    if (!el || !getDuration(el))
      return

    e.preventDefault()
    e.stopPropagation()
    isScrubbing.value = true
    seekBarRef.value?.setPointerCapture(e.pointerId)
    applySeek(e)
  }

  function onSeekPointerMove(e: PointerEvent): void {
    if (isScrubbing.value)
      applySeek(e)
  }

  function onSeekPointerUp(e: PointerEvent): void {
    if (!isScrubbing.value)
      return
    applySeek(e)
    isScrubbing.value = false
    if (seekBarRef.value?.hasPointerCapture(e.pointerId))
      seekBarRef.value.releasePointerCapture(e.pointerId)
  }

  // ── 生命周期 ──────────────────────────────────────────────

  watch(() => item()?.url, (url) => {
    // 此刻 DOM 里还是旧元素：先把旧位置存到旧 url 下
    savePosition()
    boundUrl = url ?? ''
    resetDisplay()
  }, { immediate: true })

  watch(active, (isActive, wasActive) => {
    if (wasActive && !isActive)
      savePosition()
  })

  onBeforeUnmount(savePosition)

  return {
    elRef,
    seekBarRef,
    muted,
    isReady,
    isPlaying,
    isScrubbing,
    displayPercent,
    onLoadedMetadata,
    onTimeUpdate,
    onPlay,
    onPause,
    togglePlay,
    toggleMute,
    onSurfacePointerDown,
    onSurfacePointerUp,
    onSeekPointerDown,
    onSeekPointerMove,
    onSeekPointerUp,
  }
}
