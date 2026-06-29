// https://eruda.liriliri.io/docs/api.html
import { useStorage } from '@vueuse/core'
import { watch } from 'vue'

export const enableEruda = useStorage('enableEruda', false)

watch(enableEruda, (value) => {
  if (value) {
    initEruda()
  }
  else {
    ;(window as any).eruda?.destroy()
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
