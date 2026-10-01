import type { Ref } from 'vue'
import { useDebounceFn } from '@vueuse/core'
import { getCurrentScope, onScopeDispose } from 'vue'
import { settingsApi } from '@/api/settings'
import { authSession } from '@/store/auth'

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
    sessionRef = authSession,
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

  /** 序列化一份值，用于比较「有没有真的变」。设置项都很小，字符串比较足够。 */
  function snapshot(value: T): string {
    try {
      return JSON.stringify(value) ?? 'undefined'
    }
    catch {
      // 循环引用没法比较：当作每次都不同，宁可多写一次也不要漏写。
      return String(Math.random())
    }
  }

  /**
   * 最近一次已知的服务端内容（读回来的、或写成功的）。
   *
   * 有了它就不会把刚读到的值原样写回去：组件在初始化后做一次没实际改动的赋值
   * （归一化、剪枝、去重）曾经都会白跑一次 PUT。
   */
  let lastSyncedSnapshot = snapshot(state.value)

  function applyRemoteState(value: unknown) {
    applyingRemoteState = true
    state.value = normalize(value)
    lastSyncedSnapshot = snapshot(state.value)
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
    const current = snapshot(state.value)
    if (current === lastSyncedSnapshot) {
      // 与服务端已知内容一致：这次「变化」是本地归一化造成的，不值得一次往返。
      return
    }
    try {
      await settingsApi.setItem(key, state.value)
      lastSyncedSnapshot = current
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
