<script lang="ts" setup="">
import type { FilePickerRequest } from './file-picker'
import { pendingPick, settlePending, toPickResult } from './file-picker'
import FileSelector from './FileSelector.vue'

/**
 * Mounts the one picker dialog for the whole application.
 *
 * `openFilePicker()` (called from the SDK broker or from a toolbar button) puts a
 * request here; the selection is resolved back into the SDK shape, so the caller
 * never sees the `FileManager`'s own result type.
 *
 * Keep the last request while the window is closing: clearing `pendingPick`
 * immediately would reset the picker's props (notably `extensions`), dropping
 * the filter during the leave animation and re-rendering the whole folder for
 * a dialog the user is closing.
 */
const currentRequest = computed(() => pendingPick.value?.request ?? null)
const lastRequest = shallowRef<FilePickerRequest | null>(null)
watch(currentRequest, (request) => {
  if (request)
    lastRequest.value = request
}, { immediate: true })

const visible = computed(() => currentRequest.value !== null)
const request = computed(() => currentRequest.value ?? lastRequest.value)

function onSelect(result: Parameters<typeof toPickResult>[0]) {
  const current = currentRequest.value
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
