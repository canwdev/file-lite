<script lang="ts" setup>
import type { PluginInfo } from '@/api/plugins'
import MdiIcon from '@/components/MdiIcon.vue'

defineProps<{
  plugin: PluginInfo
}>()
</script>

<template>
  <span class="plugin-icon">
    <span v-if="plugin.iconEmoji" class="plugin-icon__emoji">{{ plugin.iconEmoji }}</span>
    <img
      v-else-if="plugin.iconUrl"
      class="plugin-icon__img"
      :src="plugin.iconUrl"
      alt=""
    >
    <MdiIcon
      v-else
      name="puzzle-outline"
      class="plugin-icon__fallback"
    />
  </span>
</template>

<style lang="scss" scoped>
.plugin-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1em;
  height: 1em;
  font-size: inherit;
  line-height: 1;
}

.plugin-icon__emoji {
  font-size: 1em;
  line-height: 1;
}

.plugin-icon__img,
.plugin-icon__fallback {
  display: block;
  width: 1em;
  height: 1em;
  object-fit: contain;
}
</style>
