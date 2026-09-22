<script lang="ts" setup>
import type { PluginInfo } from '@/api/plugins'
import type { IEntry } from '@/types/server'
import type { AppParams } from '@/views/Apps/apps.ts'
import { fs } from '@/utils/fs'
import { normalizePath } from '@/utils/path/form'

const props = defineProps<{
  plugin: PluginInfo
  appParams: AppParams
}>()
const emit = defineEmits(['setTitle', 'exit'])

const HOST = 'file-lite-host'
const PLUGIN = 'file-lite-plugin'

interface PluginListEntry {
  name: string
  path: string
  ext: string
  isDirectory: boolean
  size: number | null
  lastModified: number
}

const iframeRef = ref<HTMLIFrameElement>()
const isLoading = ref(true)
const loaded = ref(false)

watch(
  () => props.plugin.name,
  (name) => {
    if (!props.appParams?.absPath)
      emit('setTitle', name)
  },
  { immediate: true },
)

watch(() => props.plugin.entryUrl, () => {
  isLoading.value = true
  loaded.value = false
})

function entryPath(dir: string, name: string) {
  return normalizePath(`${dir.replace(/\/+$/, '')}/${name}`)
}

function listEntry(dir: string, entry: IEntry): PluginListEntry {
  return {
    name: entry.name,
    path: entryPath(dir, entry.name),
    ext: entry.ext,
    isDirectory: entry.isDirectory,
    size: entry.size,
    lastModified: entry.lastModified,
  }
}

function dirOf(path: string) {
  const cut = path.replace(/\/+$/, '').lastIndexOf('/')
  return cut > 0 ? path.slice(0, cut) : path
}

function baseOf(path: string) {
  return path.slice(path.lastIndexOf('/') + 1)
}

function reply(id: number, error?: string, data?: ArrayBuffer | PluginListEntry[]) {
  iframeRef.value?.contentWindow?.postMessage({
    source: HOST,
    id,
    error,
    data,
  }, window.location.origin)
}

function postOpen() {
  const win = iframeRef.value?.contentWindow
  if (!loaded.value || !win)
    return
  const path = props.appParams?.absPath
  if (!path) {
    win.postMessage({
      source: HOST,
      event: 'open',
    }, window.location.origin)
    return
  }
  const filename = props.appParams.item?.name || ''
  emit('setTitle', filename)
  win.postMessage({
    source: HOST,
    event: 'open',
    path,
    filename,
  }, window.location.origin)
}

async function onPluginMessage(event: MessageEvent) {
  if (event.origin !== window.location.origin)
    return
  if (event.source !== iframeRef.value?.contentWindow)
    return
  const data = event.data
  if (!data || data.source !== PLUGIN || typeof data.id !== 'number')
    return

  try {
    if (data.method === 'list') {
      const path = String(data.path ?? '')
      const entries = await fs.list(path)
      reply(data.id, undefined, entries.map(entry => listEntry(path, entry)))
      return
    }
    if (data.method === 'readFile') {
      const blob = await fs.readBlob(String(data.path ?? ''))
      reply(data.id, undefined, await blob.arrayBuffer())
      return
    }
    if (data.method === 'writeFile') {
      const path = String(data.path ?? '')
      try {
        const written = await fs.writeFile(dirOf(path), baseOf(path), data.data, { conflict: 'overwrite' })
        if (!written.ok) {
          const reason = written.reason ?? 'This location is read-only'
          window.$message?.warning(reason)
          reply(data.id, reason)
          return
        }
      }
      catch (error) {
        const reason = error instanceof Error ? error.message : 'failed'
        window.$message?.warning(reason)
        reply(data.id, reason)
        return
      }
      reply(data.id)
      return
    }
    if (data.method === 'exit') {
      emit('exit')
      reply(data.id)
      return
    }
    if (data.method === 'setTitle') {
      emit('setTitle', String(data.title ?? ''))
      reply(data.id)
      return
    }
    reply(data.id, 'unknown method')
  }
  catch (error) {
    reply(data.id, error instanceof Error ? error.message : 'failed')
  }
}

function handleLoad() {
  isLoading.value = false
  loaded.value = true
  postOpen()
}

watch(() => props.appParams?.absPath, (path, prev) => {
  if (!loaded.value || path === prev)
    return
  postOpen()
})

onMounted(() => {
  window.addEventListener('message', onPluginMessage)
})

onBeforeUnmount(() => {
  window.removeEventListener('message', onPluginMessage)
})
</script>

<template>
  <div class="plugin-host">
    <iframe
      ref="iframeRef"
      class="plugin-host__frame"
      :src="plugin.entryUrl"
      :title="plugin.name"
      allow="clipboard-read; clipboard-write"
      @load="handleLoad"
    />
    <div v-if="isLoading" class="plugin-host__status vgo-u-surface">
      Loading {{ plugin.name }}...
    </div>
  </div>
</template>

<style lang="scss" scoped>
.plugin-host {
  position: relative;
  width: 100%;
  height: 100%;

  &__frame {
    display: block;
    width: 100%;
    height: 100%;
    border: 0;
  }

  &__status {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--vgo-text-secondary);
  }
}
</style>
