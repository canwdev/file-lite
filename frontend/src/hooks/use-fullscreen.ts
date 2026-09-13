import { createSharedComposable, useFullscreen } from '@vueuse/core'

const useFullscreenState = createSharedComposable(() => useFullscreen())

export function useFullscreenToggle() {
  const { isSupported, isFullscreen, toggle } = useFullscreenState()

  async function toggleFullscreen() {
    if (!isSupported.value) {
      window.$message.warning('Fullscreen is not supported')
      return
    }

    try {
      await toggle()
      window.$message.info(isFullscreen.value ? 'Fullscreen enabled' : 'Fullscreen disabled')
    }
    catch (error) {
      window.$message.error(`Fullscreen failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  return {
    isSupported,
    isFullscreen,
    toggleFullscreen,
  }
}
