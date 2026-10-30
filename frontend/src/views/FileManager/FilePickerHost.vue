<script lang="ts" setup="">
import { pendingPick, settlePending, toPickResult } from './file-picker'
import FileSelector from './FileSelector.vue'

/**
 * Mounts the one picker dialog for the whole application.
 *
 * `openFilePicker()` (called from the SDK broker or from a toolbar button) puts a
 * request here; the selection is resolved back into the SDK shape, so the caller
 * never sees the `FileManager`'s own result type.
 */
const request = computed(() => pendingPick.value?.request ?? null)
const visible = computed(() => request.value !== null)

function onSelect(result: Parameters<typeof toPickResult>[0]) {
  const current = request.value
  if (!current) {
    return
  }
  settlePending(toPickResult(result, current.mode, result.basePath))
}

function onCancel() {
  settlePending(null)
}
</script>

<template>
  <FileSelector
    :visible="visible"
    :mode="request?.mode ?? 'file'"
    :extensions="request?.extensions"
    :default-name="request?.defaultName ?? ''"
    :title="request?.title ?? ''"
    :start-path="request?.startPath ?? ''"
    :request-id="request?.id"
    wid="file-picker"
    @select="onSelect"
    @cancel="onCancel"
  />
</template>
