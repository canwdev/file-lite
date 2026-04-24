const MIN_SCALE = 0.5
const MAX_SCALE = 5.0
const STEP = 0.25

function clamp(val: number, min: number, max: number): number {
  return Math.min(Math.max(val, min), max)
}

function pinchDist(touches: TouchList): number {
  const dx = touches[0].clientX - touches[1].clientX
  const dy = touches[0].clientY - touches[1].clientY
  return Math.hypot(dx, dy)
}

export function useZoom(isImage: () => boolean) {
  const scale = ref(1)
  const panX = ref(0)
  const panY = ref(0)
  const naturalWidth = ref(0)
  const naturalHeight = ref(0)

  // True while finger(s) are actively interacting — suppresses CSS transition so
  // the image follows immediately without lag.
  const isInteracting = ref(false)

  let isPinching = false
  let pinchStartDist = 0
  let pinchStartScale = 1

  let panStartClientX = 0
  let panStartClientY = 0
  let panStartPanX = 0
  let panStartPanY = 0

  function resetZoom(): void {
    scale.value = 1
    panX.value = 0
    panY.value = 0
    naturalWidth.value = 0
    naturalHeight.value = 0
  }

  function onImageLoad(e: Event): void {
    const img = e.target as HTMLImageElement
    naturalWidth.value = img.naturalWidth
    naturalHeight.value = img.naturalHeight
  }

  // ── Pinch ──────────────────────────────────────────────────

  function startPinch(touches: TouchList): void {
    isPinching = true
    isInteracting.value = true
    pinchStartDist = pinchDist(touches)
    pinchStartScale = scale.value
  }

  function updatePinch(touches: TouchList): void {
    if (!isPinching)
      return
    const newScale = clamp(
      (pinchStartScale * pinchDist(touches)) / pinchStartDist,
      MIN_SCALE,
      MAX_SCALE,
    )
    scale.value = newScale
    if (newScale <= 1) {
      panX.value = 0
      panY.value = 0
    }
  }

  function endPinch(): void {
    isPinching = false
    isInteracting.value = false
  }

  // ── Pan ────────────────────────────────────────────────────

  function startPan(clientX: number, clientY: number): void {
    isInteracting.value = true
    panStartClientX = clientX
    panStartClientY = clientY
    panStartPanX = panX.value
    panStartPanY = panY.value
  }

  function updatePan(clientX: number, clientY: number): void {
    // Max translation so image edge stays within viewport
    const maxX = ((scale.value - 1) / 2) * window.innerWidth
    const maxY = ((scale.value - 1) / 2) * window.innerHeight
    panX.value = clamp(panStartPanX + (clientX - panStartClientX), -maxX, maxX)
    panY.value = clamp(panStartPanY + (clientY - panStartClientY), -maxY, maxY)
  }

  function endPan(): void {
    isInteracting.value = false
  }

  // ── Wheel / button zoom ────────────────────────────────────

  function zoomByWheel(deltaY: number): void {
    if (!isImage())
      return
    const newScale = clamp(
      scale.value * (deltaY > 0 ? 0.85 : 1 / 0.85),
      MIN_SCALE,
      MAX_SCALE,
    )
    scale.value = newScale
    if (newScale <= 1) {
      panX.value = 0
      panY.value = 0
    }
  }

  function zoomIn(): void {
    scale.value = clamp(scale.value + STEP, MIN_SCALE, MAX_SCALE)
  }

  function zoomOut(): void {
    const newScale = clamp(scale.value - STEP, MIN_SCALE, MAX_SCALE)
    scale.value = newScale
    if (newScale <= 1) {
      panX.value = 0
      panY.value = 0
    }
  }

  // ── Derived state ──────────────────────────────────────────

  const scalePercent = computed(() => `${Math.round(scale.value * 100)}%`)

  const resolution = computed(() =>
    naturalWidth.value ? `${naturalWidth.value}×${naturalHeight.value}` : '',
  )

  const imageStyle = computed(() => {
    const hasPan = panX.value !== 0 || panY.value !== 0
    if (scale.value === 1 && !hasPan)
      return {}
    return {
      transform: `translate(${panX.value}px, ${panY.value}px) scale(${scale.value})`,
      // No transition during interaction — image must track fingers instantly.
      // After release it eases to final position for button zoom.
      transition: isInteracting.value ? 'none' : 'transform 0.15s ease-out',
    }
  })

  return {
    scale,
    panX,
    panY,
    isPinching: () => isPinching,
    resetZoom,
    onImageLoad,
    startPinch,
    updatePinch,
    endPinch,
    startPan,
    updatePan,
    endPan,
    zoomByWheel,
    zoomIn,
    zoomOut,
    scalePercent,
    resolution,
    imageStyle,
  }
}
