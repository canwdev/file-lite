import type { Ref } from 'vue'
import type { MediaFile } from './use-media-list.ts'
import { injectShortcutScope, useShortcut } from '@/hooks/use-shortcut'

interface ZoomAPI {
  scale: Ref<number>
  isPinching: () => boolean
  startPinch: (touches: TouchList) => void
  updatePinch: (touches: TouchList) => void
  endPinch: () => void
  zoomByWheel: (deltaY: number, clientX: number, clientY: number) => void
  startPan: (clientX: number, clientY: number) => void
  updatePan: (clientX: number, clientY: number) => void
  endPan: () => void
}

interface UseSwipeOptions {
  items: Ref<MediaFile[]>
  currentIndex: Ref<number>
  zoom: ZoomAPI
  onDoubleTap: () => void
  onExit: () => void
  /** Called synchronously in the same reactive batch as currentIndex/dragOffset reset. */
  onAfterNavigate?: (isNext: boolean) => void
  /** Called synchronously after jumpToOpposite changes currentIndex. */
  onAfterJump?: () => void
}

interface NavigateOptions {
  /**
   * Swap panels in place instead of sliding. Used by keyboard navigation,
   * where a 260 ms slide per key press makes repeated presses feel laggy.
   */
  instant?: boolean
}

export function useSwipe({ items, currentIndex, zoom, onDoubleTap, onExit, onAfterNavigate, onAfterJump }: UseSwipeOptions) {
  const shortcutScope = injectShortcutScope()
  const wrapperRef = ref<HTMLElement | null>(null)
  const swipeContainerRef = ref<HTMLElement | null>(null)
  const dragOffset = ref(0)
  const withTransition = ref(false)
  const edgeOverlay = ref<'start' | 'end' | null>(null)

  let isAnimating = false
  let isDragging = false // single-finger swipe
  let isPanningLocal = false // single-finger pan (zoom > 1)
  let isTouchPointer = false
  let lastTapTime = 0
  let startY = 0
  let panStartClientX = 0
  let panStartClientY = 0
  let panMoved = false // whether pan moved beyond tap threshold
  let pendingDragOffset: number | null = null
  let dragOffsetRaf = 0

  const DOUBLE_TAP_DELAY = 300
  const THRESHOLD = 60
  const DURATION = 260

  /**
   * Run `cb` exactly once — whichever comes first:
   *   • the swipe-container's transitionend event, or
   *   • a safety timeout (DURATION + 80 ms) in case the event never fires.
   * The pending callback is cancelled by `cancelPendingTransition()` (used by
   * jumpToIndex), so an interrupted slide never mutates currentIndex afterwards.
   */
  let cancelPendingTransition: (() => void) | null = null

  function afterTransition(cb: () => void): void {
    const el = swipeContainerRef.value
    let called = false
    let timer: ReturnType<typeof setTimeout>

    function cleanup() {
      clearTimeout(timer)
      el?.removeEventListener('transitionend', run)
      cancelPendingTransition = null
    }

    function run() {
      if (called)
        return
      called = true
      cleanup()
      cb()
    }

    cancelPendingTransition = () => {
      called = true
      cleanup()
    }

    if (el) {
      el.addEventListener('transitionend', run, { once: true })
    }
    timer = setTimeout(run, DURATION + 80)
  }

  const containerStyle = computed(() => ({
    transform: `translateY(${dragOffset.value}px)`,
    transition: withTransition.value
      ? `transform ${DURATION}ms cubic-bezier(0.25, 0.46, 0.45, 0.94)`
      : 'none',
  }))

  function getHeight(): number {
    return wrapperRef.value?.offsetHeight ?? window.innerHeight
  }

  function flushPendingDragOffset(): void {
    if (dragOffsetRaf) {
      cancelAnimationFrame(dragOffsetRaf)
      dragOffsetRaf = 0
    }
    if (pendingDragOffset !== null) {
      dragOffset.value = pendingDragOffset
      pendingDragOffset = null
    }
  }

  function setDragOffsetImmediate(value: number): void {
    if (dragOffsetRaf) {
      cancelAnimationFrame(dragOffsetRaf)
      dragOffsetRaf = 0
    }
    pendingDragOffset = null
    dragOffset.value = value
  }

  function setDragOffsetThrottled(value: number): void {
    pendingDragOffset = value
    if (dragOffsetRaf)
      return

    dragOffsetRaf = requestAnimationFrame(() => {
      dragOffsetRaf = 0
      if (pendingDragOffset === null)
        return

      dragOffset.value = pendingDragOffset
      pendingDragOffset = null
    })
  }

  function navigate(isNext: boolean, { instant = false }: NavigateOptions = {}): void {
    if (isAnimating || edgeOverlay.value)
      return

    if (isNext && currentIndex.value >= items.value.length - 1) {
      edgeOverlay.value = 'end'
      snapBack()
      return
    }
    if (!isNext && currentIndex.value <= 0) {
      edgeOverlay.value = 'start'
      snapBack()
      return
    }

    if (instant) {
      // No transition: the container stays put and the panel slots rotate, so
      // the next/prev panel that was preloaded becomes the current one.
      withTransition.value = false
      setDragOffsetImmediate(0)
      currentIndex.value += isNext ? 1 : -1
      onAfterNavigate?.(isNext)
      return
    }

    isAnimating = true
    withTransition.value = true
    setDragOffsetImmediate(isNext ? -getHeight() : getHeight())

    afterTransition(() => {
      withTransition.value = false
      currentIndex.value += isNext ? 1 : -1
      setDragOffsetImmediate(0)
      onAfterNavigate?.(isNext)
      nextTick(() => {
        isAnimating = false
      })
    })
  }

  function snapBack(): void {
    if (dragOffset.value === 0 && !isAnimating)
      return
    isAnimating = true
    withTransition.value = true
    setDragOffsetImmediate(0)

    afterTransition(() => {
      withTransition.value = false
      isAnimating = false
    })
  }

  function jumpToOpposite(): void {
    const isEnd = edgeOverlay.value === 'end'
    edgeOverlay.value = null
    currentIndex.value = isEnd ? 0 : items.value.length - 1
    onAfterJump?.()
  }

  /**
   * Jump straight to an index without sliding (thumbnail strip / keyboard style).
   * Also settles a slide that is currently in flight, so its pending
   * transitionend callback can't overwrite the index we set here.
   */
  function jumpToIndex(index: number): void {
    if (!items.value.length)
      return

    const clamped = Math.min(Math.max(index, 0), items.value.length - 1)
    if (clamped === currentIndex.value)
      return

    cancelPendingTransition?.()
    isAnimating = false
    withTransition.value = false
    setDragOffsetImmediate(0)
    currentIndex.value = clamped
    onAfterJump?.()
  }

  function cleanListeners(): void {
    window.removeEventListener('mousemove', onPointerMove)
    window.removeEventListener('touchmove', onPointerMove)
    window.removeEventListener('mouseup', onPointerUp)
    window.removeEventListener('touchend', onPointerUp)
  }

  function onPointerDown(e: MouseEvent | TouchEvent): void {
    const target = e.target as HTMLElement
    if (target.closest('video, audio, button, input, a'))
      return
    if (isAnimating || edgeOverlay.value)
      return

    isTouchPointer = 'touches' in e

    // ── Two-finger pinch — cancel any ongoing gesture and hand off to zoom ──
    if (isTouchPointer && (e as TouchEvent).touches.length === 2) {
      isDragging = false
      isPanningLocal = false
      setDragOffsetImmediate(0)
      cleanListeners()
      e.preventDefault()
      zoom.startPinch((e as TouchEvent).touches)
      window.addEventListener('touchmove', onPointerMove, { passive: false })
      window.addEventListener('touchend', onPointerUp)
      return
    }

    e.preventDefault()

    const clientX = isTouchPointer
      ? (e as TouchEvent).touches[0].clientX
      : (e as MouseEvent).clientX
    const clientY = isTouchPointer
      ? (e as TouchEvent).touches[0].clientY
      : (e as MouseEvent).clientY

    // ── Zoomed in: pan instead of swipe ──────────────────────
    if (zoom.scale.value > 1) {
      isPanningLocal = true
      panMoved = false
      panStartClientX = clientX
      panStartClientY = clientY
      zoom.startPan(clientX, clientY)
      window.addEventListener('mousemove', onPointerMove)
      window.addEventListener('touchmove', onPointerMove, { passive: false })
      window.addEventListener('mouseup', onPointerUp)
      window.addEventListener('touchend', onPointerUp)
      return
    }

    // ── Normal swipe ──────────────────────────────────────────
    startY = clientY
    isDragging = true
    window.addEventListener('mousemove', onPointerMove)
    window.addEventListener('touchmove', onPointerMove, { passive: false })
    window.addEventListener('mouseup', onPointerUp)
    window.addEventListener('touchend', onPointerUp)
  }

  function onPointerMove(e: MouseEvent | TouchEvent): void {
    // ── Pinch in progress ──────────────────────────────────────
    if ('touches' in e && (e as TouchEvent).touches.length === 2 && zoom.isPinching()) {
      e.preventDefault()
      zoom.updatePinch((e as TouchEvent).touches)
      return
    }

    const clientX = 'touches' in e
      ? (e as TouchEvent).touches[0].clientX
      : (e as MouseEvent).clientX
    const clientY = 'touches' in e
      ? (e as TouchEvent).touches[0].clientY
      : (e as MouseEvent).clientY

    // ── Pan in progress ───────────────────────────────────────
    if (isPanningLocal) {
      if ('touches' in e)
        e.preventDefault()
      if (!panMoved) {
        const dist = Math.hypot(clientX - panStartClientX, clientY - panStartClientY)
        if (dist > 8)
          panMoved = true
      }
      zoom.updatePan(clientX, clientY)
      return
    }

    // ── Swipe in progress ─────────────────────────────────────
    if (!isDragging)
      return
    if ('touches' in e)
      e.preventDefault()
    setDragOffsetThrottled(clientY - startY)
  }

  function onPointerUp(): void {
    // ── End pinch ─────────────────────────────────────────────
    if (zoom.isPinching()) {
      zoom.endPinch()
      cleanListeners()
      return
    }

    // ── End pan ───────────────────────────────────────────────
    if (isPanningLocal) {
      isPanningLocal = false
      zoom.endPan()
      cleanListeners()
      // Small pan = tap; check double-tap for collect
      if (isTouchPointer && !panMoved) {
        const now = Date.now()
        if (now - lastTapTime < DOUBLE_TAP_DELAY) {
          onDoubleTap()
          lastTapTime = 0
        }
        else {
          lastTapTime = now
        }
      }
      return
    }

    // ── End swipe ─────────────────────────────────────────────
    if (!isDragging)
      return
    isDragging = false
    cleanListeners()
    flushPendingDragOffset()
    const delta = dragOffset.value
    if (Math.abs(delta) >= THRESHOLD) {
      navigate(delta < 0)
    }
    else {
      snapBack()
      if (isTouchPointer) {
        const now = Date.now()
        if (now - lastTapTime < DOUBLE_TAP_DELAY) {
          onDoubleTap()
          lastTapTime = 0
        }
        else {
          lastTapTime = now
        }
      }
    }
  }

  function onWheel(e: WheelEvent): void {
    if (e.ctrlKey) {
      zoom.zoomByWheel(e.deltaY, e.clientX, e.clientY)
      return
    }
    if (isAnimating)
      return
    navigate(e.deltaY > 0)
  }

  useShortcut({
    scope: shortcutScope,
    combo: 'escape',
    handler: () => {
      if (edgeOverlay.value) {
        edgeOverlay.value = null
        return
      }
      onExit()
    },
  })

  useShortcut({
    scope: shortcutScope,
    combo: ['arrowdown', 'arrowright', 'pagedown', 'j'],
    handler: () => navigate(true, { instant: true }),
  })

  useShortcut({
    scope: shortcutScope,
    combo: ['arrowup', 'arrowleft', 'pageup', 'k'],
    handler: () => navigate(false, { instant: true }),
  })

  onBeforeUnmount(() => {
    flushPendingDragOffset()
    cleanListeners()
  })

  return {
    wrapperRef,
    swipeContainerRef,
    containerStyle,
    edgeOverlay,
    navigate,
    jumpToOpposite,
    jumpToIndex,
    onPointerDown,
    onWheel,
  }
}
