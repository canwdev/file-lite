<script setup lang="ts">
import { computed } from 'vue'
import { resolveMdiComponent } from '@/utils/icons'

const props = defineProps<{
  /** 图标标识：支持 'folder' / 'mdi-folder' / 'mdi mdi-folder' 三种写法 */
  name?: string | null
}>()

const component = computed(() => resolveMdiComponent(props.name))
</script>

<template>
  <component :is="component" v-bind="$attrs" />
</template>
