import { useEventListener } from '@vueuse/core'
import { computed, ref } from 'vue'

/**
 * The element that fills the screen right now, or null.
 *
 * Only one element can be fullscreen at a time, so one shared ref covers every
 * window: each window asks whether it is that element instead of keeping its
 * own copy of the state.
 */
const fullscreenElement = ref<Element | null>(null)

function syncFullscreenElement() {
  fullscreenElement.value = document.fullscreenElement
}

/**
 * Element-level fullscreen: a piece of the page fills the screen, instead of
 * the whole document.
 *
 * Leaving fullscreen with Esc fires the same event as `exitFullscreen`, so the
 * toggle follows what the browser actually shows and never drifts from it.
 */
export function useElementFullscreen() {
  useEventListener(document, 'fullscreenchange', syncFullscreenElement)

  const isSupported = computed(() => typeof document !== 'undefined' && document.fullscreenEnabled)

  async function toggleFullscreen(element: Element | null | undefined) {
    if (!element) {
      return
    }

    try {
      if (fullscreenElement.value === element) {
        await document.exitFullscreen()
        return
      }
      await element.requestFullscreen()
    }
    catch (error) {
      window.$message.error(`Fullscreen failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  return {
    isSupported,
    fullscreenElement,
    toggleFullscreen,
  }
}
