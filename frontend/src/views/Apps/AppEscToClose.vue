<script setup lang="ts">
/**
 * Closes the active app window on Esc. Mounted after the app content, so an
 * app shortcut registered first (the gallery overlay) can take the key while
 * it is enabled. Menus and dialogs keep Esc for themselves.
 */
import { useShortcut } from '@/hooks/use-shortcut'

const props = defineProps<{
  scope: string
}>()

const emit = defineEmits<{
  close: []
}>()

function isPopupOpen() {
  const nodes = document.querySelectorAll('.el-message-box, .el-overlay, .vgo-context-menu')
  return [...nodes].some((node) => {
    if (!(node instanceof HTMLElement))
      return false
    const style = getComputedStyle(node)
    return style.display !== 'none' && style.visibility !== 'hidden'
  })
}

useShortcut({
  scope: props.scope,
  combo: 'escape',
  description: 'Close window',
  allowInInput: true,
  preventDefault: false,
  handler: (event) => {
    if (isPopupOpen())
      return
    event.preventDefault()
    emit('close')
  },
})
</script>

<template>
  <span hidden />
</template>
