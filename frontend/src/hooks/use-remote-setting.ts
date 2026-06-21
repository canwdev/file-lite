import type { Ref } from 'vue'
import { useDebounceFn } from '@vueuse/core'
import { getCurrentScope, onScopeDispose } from 'vue'
import { settingsApi } from '@/api/settings'
import { authToken } from '@/store/auth'

interface UseRemoteSettingOptions<T> {
  key: string
  createDefaultValue: () => T
  sessionRef?: Ref<string>
  normalize?: (value: unknown) => T
  debounceMs?: number
  deep?: boolean
  autoInitialize?: boolean
  throwOnInitError?: boolean
}

export function useRemoteSetting<T>(options: UseRemoteSettingOptions<T>) {
  const {
    key,
    createDefaultValue,
    sessionRef = authToken,
    normalize = value => (value as T),
    debounceMs = 120,
    deep = true,
    autoInitialize = true,
    throwOnInitError = false,
  } = options

  const state = ref<T>(createDefaultValue())
  let initializedSession = ''
  let applyingRemoteState = false
  let stopSubscription: (() => void) | null = null

  function applyRemoteState(value: unknown) {
    applyingRemoteState = true
    state.value = normalize(value)
    queueMicrotask(() => {
      applyingRemoteState = false
    })
  }

  function bindSubscription() {
    if (stopSubscription) {
      return
    }
    stopSubscription = settingsApi.subscribe((message) => {
      if (message.key !== key) {
        return
      }
      applyRemoteState(message.value)
    })
  }

  function unbindSubscription() {
    stopSubscription?.()
    stopSubscription = null
  }

  const persistState = useDebounceFn(async () => {
    if (!sessionRef.value || initializedSession !== sessionRef.value) {
      return
    }
    try {
      await settingsApi.setItem(key, state.value)
    }
    catch (error) {
      console.error(error)
    }
  }, debounceMs)

  async function ensureInitialized() {
    if (!sessionRef.value) {
      initializedSession = ''
      applyRemoteState(createDefaultValue())
      return
    }
    if (initializedSession === sessionRef.value) {
      return
    }
    try {
      bindSubscription()
      applyRemoteState(await settingsApi.getItem(key))
      initializedSession = sessionRef.value
    }
    catch (error) {
      console.error(error)
      if (throwOnInitError) {
        throw error
      }
    }
  }

  watch(
    state,
    () => {
      if (applyingRemoteState) {
        return
      }
      void persistState()
    },
    { deep },
  )

  watch(sessionRef, (value, oldValue) => {
    if (!value) {
      initializedSession = ''
      unbindSubscription()
      if (oldValue) {
        applyRemoteState(createDefaultValue())
      }
      return
    }
    if (value !== oldValue) {
      initializedSession = ''
      if (autoInitialize) {
        void ensureInitialized()
      }
    }
  })

  if (autoInitialize) {
    void ensureInitialized()
  }
  if (getCurrentScope()) {
    onScopeDispose(() => {
      unbindSubscription()
    })
  }

  return {
    state,
    ensureInitialized,
  }
}
