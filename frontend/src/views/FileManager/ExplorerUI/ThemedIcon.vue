<script lang="ts" setup>
withDefaults(defineProps<{
  iconClass: string
}>(), {})
</script>

<template>
  <div class="themed-icon">
    <span v-if="iconClass" class="themed-icon-class" :class="iconClass" />
    <span v-else class="themed-icon-class mdi mdi-file-question" />
  </div>
</template>

<style lang="scss" scoped>
.themed-icon {
  display: inline-flex;
  align-content: center;
  justify-content: center;
  position: relative;
  width: 100%;
  height: 100%;
  flex-shrink: 0;

  .themed-icon-class {
    line-height: 1;
    color: var(--vgo-primary);
  }
}
</style>
