// https://eruda.liriliri.io/docs/api.html
import { useStorage } from '@vueuse/core'
import { watch } from 'vue'

export const enableDebug = useStorage('enableDebug', false)

watch(enableDebug, (value) => {
  if (value) {
    initEruda()
    document.documentElement.classList.add('is-debug')
  }
  else {
    ;(window as any).eruda?.destroy()
    document.documentElement.classList.remove('is-debug')
  }
}, { immediate: true })

export function initEruda() {
  if ((window as any).eruda) {
    ;(window as any).eruda.init()
    return
  }
  const script = document.createElement('script')
  script.src = 'https://cdn.jsdelivr.net/npm/eruda'
  script.onload = () => {
    ;(window as any).eruda?.init()
  }
  document.head.appendChild(script)
}
