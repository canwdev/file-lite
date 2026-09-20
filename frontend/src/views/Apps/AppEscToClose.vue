<script setup lang="ts">
/**
 * 挂在 App 内容之后：同 scope 里先注册的 Esc（编辑器 / 图库等）优先；
 * 没有自己绑 Esc 的 App 则落到这里关窗。
 */
import { useShortcut } from '@/hooks/use-shortcut'

const props = defineProps<{
  scope: string
}>()

const emit = defineEmits<{
  close: []
}>()

function isMessageBoxOpen() {
  return !!document.querySelector('.el-message-box')
}

useShortcut({
  scope: props.scope,
  combo: 'escape',
  description: 'Close window',
  allowInInput: true,
  preventDefault: false,
  handler: (event) => {
    if (isMessageBoxOpen())
      return
    event.preventDefault()
    emit('close')
  },
})
</script>

<template>
  <span hidden />
</template>
