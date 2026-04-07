import type { Ref } from 'vue'

/** Type-only stub: tsconfig paths redirect vgo-ui imports here so vue-tsc skips package source. */

export function useBeforeUnload(_checkIsChanged: () => boolean): void {}

export function useUnSavedChanges(): { isChanged: Ref<boolean> } {
  return null as unknown as { isChanged: Ref<boolean> }
}

export function useSaveShortcut(_saveFn: () => void): void {}
