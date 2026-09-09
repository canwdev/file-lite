/**
 * 底部缩略图导航条 —— 自动居中 / 下标进度 / 滚轮与触摸横向滚动。
 *
 * 与 GalleryThumbStrip.vue 配套：
 * - 当前项变化（键盘、滚轮、拖拽、点击缩略图）后把对应格子滚到轨道中间；
 * - 进度 = (当前下标 + 1) / 总数，由组件的半透明主题色背景层呈现（不是滚动位置）；
 * - 轨道上的滚轮映射为横向滚动，不触发图片切换（由模板的 .stop.prevent 拦下）。
 */
import type { Ref } from 'vue'
import type { MediaFile } from './use-media-list.ts'

interface UseThumbStripOptions {
  items: Ref<MediaFile[]>
  currentIndex: Ref<number>
}

export function useThumbStrip({ items, currentIndex }: UseThumbStripOptions) {
  const trackRef = ref<HTMLElement | null>(null)

  /** 当前图片在列表中的位置，0%~100% */
  const progressWidth = computed(() => {
    const total = items.value.length
    if (!total)
      return '0%'
    return `${((currentIndex.value + 1) / total * 100).toFixed(2)}%`
  })

  /** 把当前格子滚到轨道中央（首尾项由浏览器自然夹紧） */
  function centerCurrent(behavior: ScrollBehavior): void {
    const track = trackRef.value
    const cell = track?.children[currentIndex.value]
    if (!track || !(cell instanceof HTMLElement))
      return
    track.scrollTo({
      left: cell.offsetLeft - (track.clientWidth - cell.offsetWidth) / 2,
      behavior,
    })
  }

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

  watch(currentIndex, () => {
    void nextTick(() => centerCurrent('smooth'))
  })

  // 列表身份变化（换目录 / 换列表）：立刻回到当前项，不做平滑滚动
  watch(items, () => {
    void nextTick(() => centerCurrent('auto'))
  })

  onMounted(() => {
    void nextTick(() => centerCurrent('auto'))
  })

  onBeforeUnmount(() => {
    cleanTouchPanListeners()
  })

  return { trackRef, progressWidth, onTrackWheel, onTrackTouchStart }
}
