<script setup lang="ts">
/**
 * Closes the active app window on Esc. Mounted after the app content, so an
 * app shortcut registered first (the gallery overlay) can take the key while
 * it is enabled. Menus and dialogs keep Esc for themselves — the shortcut
 * layer already stops dispatching while a popup layer is open.
 */
import { useShortcut } from '@/hooks/use-shortcut'

const props = defineProps<{
  scope: string
}>()

const emit = defineEmits<{
  close: []
}>()

useShortcut({
  scope: props.scope,
  combo: 'escape',
  description: 'Close window',
  allowInInput: true,
  preventDefault: false,
  handler: (event) => {
    event.preventDefault()
    emit('close')
  },
})
</script>

<template>
  <span hidden />
</template>
