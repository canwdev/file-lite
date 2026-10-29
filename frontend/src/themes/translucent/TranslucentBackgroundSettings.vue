<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { localSettingsStore } from '@/store'
import { DEFAULT_WALLPAPER_PRESET, resolveWallpaper, WALLPAPER_PRESETS } from './presets'
import { canLoadImage, dataUrlToBytes, formatBytes, optimizeImageFile } from './wallpaper'

const fileInput = ref<HTMLInputElement | null>(null)
const urlDraft = ref('')
const busy = ref(false)
const applyingUrl = ref(false)
const message = ref('')
let urlRequestId = 0

const wallpaperUrl = computed(() => localSettingsStore.value.wallpaperUrl)

const presetId = computed(() => {
  if (wallpaperUrl.value)
    return 'custom'
  const url = resolveWallpaper(localSettingsStore.value)
  return WALLPAPER_PRESETS.find(preset => preset.url === url)?.id ?? DEFAULT_WALLPAPER_PRESET
})

const sourceText = computed(() => {
  if (wallpaperUrl.value) {
    return wallpaperUrl.value.startsWith('data:')
      ? `Custom image (${formatBytes(dataUrlToBytes(wallpaperUrl.value))})`
      : 'Custom URL'
  }
  const preset = WALLPAPER_PRESETS.find(item => item.id === presetId.value)
  return `Preset: ${preset?.label ?? 'Default'}`
})

const hint = computed(() => message.value || sourceText.value)

watch(wallpaperUrl, (value) => {
  urlDraft.value = value.startsWith('data:') ? '' : value
}, { immediate: true })

function onPresetChange(event: Event) {
  const next = (event.target as HTMLSelectElement).value
  if (next === 'custom')
    return
  urlRequestId += 1
  applyingUrl.value = false
  localSettingsStore.value.wallpaperPreset = next
  localSettingsStore.value.wallpaperUrl = ''
  message.value = ''
}

async function applyUrl() {
  const requestId = ++urlRequestId
  const next = urlDraft.value.trim()
  if (!next) {
    applyingUrl.value = false
    localSettingsStore.value.wallpaperUrl = ''
    message.value = ''
    return
  }

  applyingUrl.value = true
  message.value = 'Loading image…'
  try {
    const ok = await canLoadImage(next)
    if (requestId !== urlRequestId)
      return
    if (!ok) {
      message.value = 'Could not load this image.'
      return
    }
    // The draft may have changed while the image was loading.
    if (urlDraft.value.trim() !== next)
      return
    localSettingsStore.value.wallpaperUrl = next
    message.value = ''
  }
  finally {
    if (requestId === urlRequestId)
      applyingUrl.value = false
  }
}

function pickFile() {
  fileInput.value?.click()
}

async function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file)
    return

  urlRequestId += 1
  applyingUrl.value = false
  busy.value = true
  message.value = 'Optimizing image…'
  try {
    const dataUrl = await optimizeImageFile(file)
    localSettingsStore.value.wallpaperUrl = dataUrl
    message.value = `Using uploaded image (${formatBytes(file.size)} → ${formatBytes(dataUrlToBytes(dataUrl))}).`
  }
  catch (error) {
    message.value = error instanceof Error ? error.message : 'Could not process this image.'
  }
  finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="translucent-background">
    <div class="translucent-background__head">
      <span>Background</span>
      <span class="translucent-background__hint" :title="hint">{{ hint }}</span>
    </div>

    <div class="translucent-background__row">
      <select class="vgo-input translucent-background__preset" :value="presetId" @change="onPresetChange">
        <option v-for="preset in WALLPAPER_PRESETS" :key="preset.id" :value="preset.id">
          {{ preset.label }}
        </option>
        <option value="custom" disabled>
          Custom
        </option>
      </select>
      <button
        type="button"
        class="vgo-button "
        title="Upload an image (max 10 MB, resized automatically)"
        :disabled="busy"
        @click="pickFile"
      >
        {{ busy ? 'Uploading' : 'Upload...' }}
      </button>
      <input ref="fileInput" class="translucent-background__file" type="file" accept="image/*" @change="onFileChange">
    </div>

    <div class="translucent-background__row">
      <input
        v-model="urlDraft"
        class="vgo-input translucent-background__url"
        type="url"
        placeholder="Image URL"
        @keydown.enter.prevent="applyUrl"
      >
      <button type="button" class="vgo-button " @click="applyUrl">
        Apply
      </button>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.translucent-background {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--vgo-space-2);
  width: 100%;
  min-width: 0;
}

.translucent-background__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--vgo-space-2);
  min-width: 0;
  font-size: var(--vgo-font-sm);
  color: var(--vgo-text-secondary);
}

.translucent-background__row {
  display: flex;
  align-items: center;
  gap: var(--vgo-space-1);
  min-width: 0;
}

.translucent-background__preset,
.translucent-background__url {
  flex: 1;
  min-width: 0;
}

.translucent-background__file {
  display: none;
}

.translucent-background__hint {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
