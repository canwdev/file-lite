<script setup lang="ts">
/**
 * App 窗口统一关窗：Alt+W（与标签关闭同键；有活动 App 时外壳标签键会让路）。
 * 挂在内容之后；各 App 不要再拦截 Alt+W。
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
  combo: 'alt+w',
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
