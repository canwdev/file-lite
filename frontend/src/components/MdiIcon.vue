<script setup lang="ts">
import { computed } from 'vue'
import { normalizeMdiName, resolveMdiComponent } from '@/utils/icons'

const props = defineProps<{
  /** 图标标识：支持 'folder' / 'mdi-folder' / 'mdi mdi-folder' 三种写法 */
  name?: string | null
}>()

const component = computed(() => resolveMdiComponent(props.name))
/**
 * 解析出来的注册表名，挂在 `data-icon` 上。
 *
 * `MdiIcon` 对未注册的名字会**静默**回落成问号图标（见 AGENTS.md 的图标约定），
 * 所以「渲染出了一个 svg」并不能证明用对了图标。把这个名字暴露出来，
 * 测试就能断言「这里确实是 lock-outline」，而不是只断言「有个图标」。
 */
const iconName = computed(() => normalizeMdiName(props.name))
</script>

<template>
  <component :is="component" v-bind="$attrs" :data-icon="iconName || undefined" />
</template>
