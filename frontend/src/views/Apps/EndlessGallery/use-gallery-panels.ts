import type { CSSProperties, Ref } from 'vue'
import type { MediaFile } from './use-media-list.ts'

interface GalleryPanelZoom {
  imageStyle: Ref<CSSProperties>
  setImageResolution: (img: HTMLImageElement) => void
}

interface UseGalleryPanelsOptions {
  items: Ref<MediaFile[]>
  currentIndex: Ref<number>
  currentItem: Ref<MediaFile | null>
  zoom: GalleryPanelZoom
}

export function useGalleryPanels({
  items,
  currentIndex,
  currentItem,
  zoom,
}: UseGalleryPanelsOptions) {
  const panelItems = ref<(MediaFile | null)[]>([null, null, null])
  const panelLoadedUrls = ref(['', '', ''])
  const currentSlot = ref(0)

  function setPanelItem(slotIdx: number, item: MediaFile | null): void {
    const currentLoadedUrl = panelLoadedUrls.value[slotIdx]
    panelItems.value[slotIdx] = item

    if (!item || item.type !== 'image') {
      panelLoadedUrls.value[slotIdx] = ''
      return
    }

    if (currentLoadedUrl !== item.url)
      panelLoadedUrls.value[slotIdx] = ''
  }

  function resetPanels(): void {
    const ci = currentIndex.value
    currentSlot.value = 0
    setPanelItem(0, items.value[ci] ?? null)
    setPanelItem(1, items.value[ci + 1] ?? null)
    setPanelItem(2, items.value[ci - 1] ?? null)
  }

  watch(items, resetPanels, { immediate: true })

  function onPanelImageLoad(e: Event, slotIdx: number): void {
    const panelItem = panelItems.value[slotIdx]
    if (panelItem?.type !== 'image')
      return

    panelLoadedUrls.value[slotIdx] = panelItem.url
    if (slotIdx === currentSlot.value)
      zoom.setImageResolution(e.target as HTMLImageElement)
  }

  function syncCurrentImageResolution(img: HTMLImageElement): void {
    if (currentItem.value?.type !== 'image')
      return

    const panelItem = panelItems.value[currentSlot.value]
    if (panelItem?.type !== 'image' || !img.complete || !img.naturalWidth)
      return

    panelLoadedUrls.value[currentSlot.value] = panelItem.url
    zoom.setImageResolution(img)
  }

  function onAfterNavigate(isNext: boolean): void {
    const ci = currentIndex.value
    if (isNext) {
      const slotToUpdate = (currentSlot.value + 2) % 3
      setPanelItem(slotToUpdate, items.value[ci + 1] ?? null)
      currentSlot.value = (currentSlot.value + 1) % 3
      return
    }

    const slotToUpdate = (currentSlot.value + 1) % 3
    setPanelItem(slotToUpdate, items.value[ci - 1] ?? null)
    currentSlot.value = (currentSlot.value + 2) % 3
  }

  function onAfterJump(): void {
    resetPanels()
  }

  return {
    panelItems,
    panelLoadedUrls,
    currentSlot,
    onPanelImageLoad,
    syncCurrentImageResolution,
    onAfterNavigate,
    onAfterJump,
  }
}
