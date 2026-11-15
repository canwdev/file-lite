<script setup lang="ts">
import type { ModalWindowButton } from '@canwdev/vgo-ui'
import { ModalWindow } from '@canwdev/vgo-ui'
import {
  installAvailableUpdate,
  remindLater,
  skipAvailableVersion,
  updateBusy,
  updateChannel,
  updateDialogVisible,
  updateErrorMessage,
  updateInfo,
  updateStatus,
} from '@/store/update'

const current = computed(() => updateInfo.value?.current ?? updateStatus.value.from ?? '')
const latest = computed(() => updateInfo.value?.latest ?? updateStatus.value.to ?? '')
const notesURL = computed(() => updateInfo.value?.available ? updateInfo.value.notesUrl : '')
const hasError = computed(() => Boolean(updateStatus.value.error || updateErrorMessage.value))
const finished = computed(() => updateStatus.value.phase === 'done' && !hasError.value)
const showProgress = computed(() =>
  updateBusy.value || finished.value || hasError.value,
)
const visible = computed(() =>
  updateDialogVisible.value && (updateBusy.value || Boolean(updateInfo.value?.available) || hasError.value),
)
const title = computed(() => latest.value
  ? $t('file_lite_i18n.update_available_0', [latest.value])
  : $t('file_lite_i18n.updates'))
const channelLabel = computed(() => updateChannel.value === 'preview'
  ? $t('file_lite_i18n.update_channel_preview')
  : $t('file_lite_i18n.update_channel_stable'))

const progressPercent = computed(() => {
  const snapshot = updateStatus.value
  if (snapshot.phase && snapshot.phase !== 'download')
    return 100
  if (typeof snapshot.percent === 'number')
    return Math.min(100, Math.max(0, snapshot.percent))
  if (snapshot.total && snapshot.total > 0)
    return Math.min(100, Math.max(0, Math.round((snapshot.received ?? 0) * 100 / snapshot.total)))
  return 0
})

const progressLabel = computed(() => {
  if (hasError.value)
    return $t('file_lite_i18n.update_failed_0', [updateStatus.value.error ?? updateErrorMessage.value])
  switch (updateStatus.value.phase) {
    case 'download':
      return updateStatus.value.total && updateStatus.value.total > 0
        ? `${$t('file_lite_i18n.downloading')} ${progressPercent.value}%`
        : `${$t('file_lite_i18n.downloading')}${ELLIPSIS}`
    case 'verify':
    case 'install':
      return `${$t('file_lite_i18n.installing')}${ELLIPSIS}`
    case 'extract':
      return `${$t('file_lite_i18n.extracting')}${ELLIPSIS}`
    case 'done':
      return `${$t('file_lite_i18n.updated_restarting')}${ELLIPSIS}`
    default:
      return updateBusy.value ? `${$t('file_lite_i18n.updating')}${ELLIPSIS}` : ''
  }
})

const buttons = computed<ModalWindowButton[]>(() => {
  if (updateBusy.value || finished.value)
    return []
  if (hasError.value) {
    const list: ModalWindowButton[] = []
    if (updateInfo.value?.available) {
      list.push({
        label: $t('file_lite_i18n.retry'),
        variant: 'primary',
        onClick: () => {
          void installAvailableUpdate()
          return false
        },
      })
    }
    list.push({ label: $t('file_lite_i18n.close'), variant: 'text', onClick: () => remindLater() })
    return list
  }
  return [
    {
      label: $t('file_lite_i18n.install_update'),
      variant: 'primary',
      onClick: () => {
        void installAvailableUpdate()
        return false
      },
    },
    { label: $t('file_lite_i18n.remind_later'), variant: 'text', onClick: () => remindLater() },
    { label: $t('file_lite_i18n.skip_this_version'), variant: 'text', onClick: () => skipAvailableVersion() },
  ]
})

function onVisibleChange(value: boolean) {
  if (!value)
    remindLater()
}
</script>

<template>
  <ModalWindow
    :visible="visible"
    :title="title"
    :buttons="buttons"
    :closable="!updateBusy && !finished"
    :mask-closable="!updateBusy && !finished"
    @update:visible="onVisibleChange"
  >
    <div class="update-dialog">
      <div class="update-dialog__meta">
        <span class="update-dialog__versions">{{ current }} → {{ latest }}</span>
        <span class="vgo-badge">{{ channelLabel }}</span>
      </div>

      <a
        v-if="notesURL"
        class="update-dialog__notes"
        :href="notesURL"
        target="_blank"
        rel="noopener noreferrer"
      >{{ $t('file_lite_i18n.release_notes') }}</a>

      <div v-if="showProgress" class="update-dialog__progress">
        <div
          class="vgo-progress"
          :class="{
            'vgo-progress--success': updateStatus.phase === 'done' && !hasError,
            'vgo-progress--danger': hasError,
          }"
        >
          <div class="vgo-progress__value" :style="{ width: `${progressPercent}%` }" />
        </div>
        <div class="update-dialog__label" :class="{ 'is-error': hasError }">
          {{ progressLabel }}
        </div>
      </div>
    </div>
  </ModalWindow>
</template>

<style scoped lang="scss">
.update-dialog {
  display: flex;
  flex-direction: column;
  gap: var(--vgo-space-2);
  min-width: 20rem;
}

.update-dialog__meta {
  display: flex;
  gap: var(--vgo-space-2);
  align-items: center;
  justify-content: space-between;
}

.update-dialog__versions {
  font-size: var(--vgo-font-md);
  font-variant-numeric: tabular-nums;
}

.update-dialog__notes {
  font-size: var(--vgo-font-sm);
  color: var(--vgo-primary);
  text-decoration: none;
}

.update-dialog__progress {
  display: flex;
  flex-direction: column;
  gap: var(--vgo-space-1);
}

.update-dialog__label {
  font-size: var(--vgo-font-sm);
  color: var(--vgo-text-secondary);
}

.update-dialog__label.is-error {
  color: var(--vgo-danger);
}
</style>
