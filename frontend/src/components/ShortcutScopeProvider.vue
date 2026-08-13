<script setup lang="ts">
import { provide } from 'vue'
import { shortcutScopeKey } from '@/hooks/use-shortcut'

const props = defineProps<{
  scope: string
}>()

provide(shortcutScopeKey, props.scope)
</script>

<template>
  <slot />
</template>
