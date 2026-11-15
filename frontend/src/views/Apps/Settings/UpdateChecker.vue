<script setup lang="ts">
import { checkForUpdate, updateBusy, updateChecking, updateDialogVisible, updateInfo } from '@/store/update'

const primaryLabel = computed(() => {
  if (updateBusy.value)
    return `${$t('file_lite_i18n.updating')}${ELLIPSIS}`
  if (updateChecking.value)
    return `${$t('file_lite_i18n.checking')}${ELLIPSIS}`
  if (updateInfo.value?.available)
    return $t('file_lite_i18n.update_to_0', [updateInfo.value.latest])
  return $t('file_lite_i18n.check_for_updates')
})

function onPrimaryClick() {
  if (updateBusy.value)
    return
  if (updateInfo.value?.available) {
    updateDialogVisible.value = true
    return
  }
  void checkForUpdate({ manual: true })
}
</script>

<template>
  <button
    type="button"
    class="vgo-button vgo-button--primary"
    :disabled="updateBusy || updateChecking"
    @click="onPrimaryClick"
  >
    {{ primaryLabel }}
  </button>
</template>
