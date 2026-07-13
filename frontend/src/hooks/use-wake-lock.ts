import { createSharedComposable, useWakeLock } from '@vueuse/core'

const useWakeLockState = createSharedComposable(() => useWakeLock())

export function useWakeLockToggle() {
  const { isSupported, isActive, request, release } = useWakeLockState()

  async function toggleWakeLock() {
    if (!isSupported.value) {
      window.$message.warning('Wake Lock is not supported')
      return
    }

    try {
      if (isActive.value) {
        await release()
        window.$message.info('Wake Lock disabled')
        return
      }

      await request('screen')
      if (isActive.value)
        window.$message.success('Wake Lock enabled')
      else
        window.$message.warning('Wake Lock will activate when tab is visible')
    }
    catch (error) {
      window.$message.error(`Wake Lock failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  return {
    isSupported,
    isActive,
    toggleWakeLock,
  }
}
