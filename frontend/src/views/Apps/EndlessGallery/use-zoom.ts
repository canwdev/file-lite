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

function pinchCenter(touches: TouchList): { clientX: number, clientY: number } {
  return {
    clientX: (touches[0].clientX + touches[1].clientX) / 2,
    clientY: (touches[0].clientY + touches[1].clientY) / 2,
  }
}

export function useZoom(
  isImage: () => boolean,
  getViewportRect?: () => DOMRect | undefined,
) {
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

  function setImageResolution(img: HTMLImageElement): void {
    naturalWidth.value = img.naturalWidth
    naturalHeight.value = img.naturalHeight
  }

  function onImageLoad(e: Event): void {
    const img = e.target as HTMLImageElement
    setImageResolution(img)
  }

  function viewportRect(): DOMRect | undefined {
    return getViewportRect?.()
  }

  function viewportSize(): { width: number, height: number } {
    const rect = viewportRect()
    return {
      width: rect?.width || window.innerWidth,
      height: rect?.height || window.innerHeight,
    }
  }

  function clampPan(x: number, y: number, nextScale = scale.value): { x: number, y: number } {
    if (nextScale <= 1)
      return { x: 0, y: 0 }

    const { width, height } = viewportSize()
    const maxX = ((nextScale - 1) / 2) * width
    const maxY = ((nextScale - 1) / 2) * height

    return {
      x: clamp(x, -maxX, maxX),
      y: clamp(y, -maxY, maxY),
    }
  }

  function zoomAt(nextScale: number, center?: { clientX: number, clientY: number }): void {
    const oldScale = scale.value
    const newScale = clamp(nextScale, MIN_SCALE, MAX_SCALE)
    if (newScale <= 1) {
      scale.value = newScale
      panX.value = 0
      panY.value = 0
      return
    }

    const rect = viewportRect()
    const viewportCenterX = rect ? rect.left + rect.width / 2 : window.innerWidth / 2
    const viewportCenterY = rect ? rect.top + rect.height / 2 : window.innerHeight / 2
    const zoomCenterX = (center?.clientX ?? viewportCenterX) - viewportCenterX
    const zoomCenterY = (center?.clientY ?? viewportCenterY) - viewportCenterY
    const ratio = newScale / oldScale
    const nextPan = clampPan(
      zoomCenterX - ratio * (zoomCenterX - panX.value),
      zoomCenterY - ratio * (zoomCenterY - panY.value),
      newScale,
    )

    scale.value = newScale
    panX.value = nextPan.x
    panY.value = nextPan.y
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
    zoomAt(newScale, pinchCenter(touches))
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
    const nextPan = clampPan(
      panStartPanX + (clientX - panStartClientX),
      panStartPanY + (clientY - panStartClientY),
    )
    panX.value = nextPan.x
    panY.value = nextPan.y
  }

  function endPan(): void {
    isInteracting.value = false
  }

  // ── Wheel / button zoom ────────────────────────────────────

  function zoomByWheel(deltaY: number, clientX: number, clientY: number): void {
    if (!isImage())
      return
    zoomAt(scale.value * (deltaY > 0 ? 0.85 : 1 / 0.85), { clientX, clientY })
  }

  function zoomIn(): void {
    zoomAt(scale.value + STEP)
  }

  function zoomOut(): void {
    zoomAt(scale.value - STEP)
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
    setImageResolution,
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
