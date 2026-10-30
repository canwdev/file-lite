<script lang="ts" setup>
import type { PluginInfo } from '@/api/plugins'
import type { SdkLaunch } from '@/sdk/contract'
import type { AppParams } from '@/views/Apps/apps.ts'
import { createSdkBroker, dirOf } from '@/sdk/broker'
import { createIframeBridge } from '@/sdk/iframe-bridge'
import { fs } from '@/utils/fs'
import { launchFromParams, paramsFromLaunch } from './app-launch'

const props = defineProps<{
  plugin: PluginInfo
  appParams: AppParams
}>()
const emit = defineEmits(['setTitle', 'exit', 'selectItems', 'revealItem', 'updateAppParams'])

/** What a plugin sees as its launch state; `updateLaunch` may override it. */
const launchOverride = ref<SdkLaunch | null>(null)

const broker = createSdkBroker({
  getLaunch: () => {
    const launch = launchOverride.value ?? launchFromParams(props.appParams)
    return launch.path ? launch : null
  },
  setLaunch: (launch) => {
    launchOverride.value = launch
    emit('updateAppParams', paramsFromLaunch(launch, props.appParams))
  },
  close: () => emit('exit'),
  setTitle: (title: string) => emit('setTitle', title),
  selectItems: (names: string[]) => emit('selectItems', names),
  revealItem: (name: string) => emit('revealItem', name),
}, fs)

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

watch(() => props.appParams, () => {
  // A launch published by the plugin itself is already in the prop.
  if (launchOverride.value?.path === (props.appParams?.absPath ?? ''))
    return
  launchOverride.value = null
})

const bridge = createIframeBridge({
  getWindow: () => iframeRef.value?.contentWindow ?? null,
  invoke: async (method, payload) => {
    try {
      return await broker.invoke(method, payload)
    }
    catch (error) {
      // v1 showed a warning for failed writes; keep that, and let the reply
      // carry the error to the plugin.
      if (method === 'writeFile') {
        window.$message?.warning(error instanceof Error ? error.message : 'failed')
      }
      throw error
    }
  },
})

function postOpen() {
  if (!loaded.value)
    return
  const path = props.appParams?.absPath
  if (!path) {
    bridge.pushOpen(undefined)
    return
  }
  const filename = props.appParams.item?.name || ''
  emit('setTitle', filename)
  bridge.pushOpen({
    path,
    filename,
    directory: props.appParams.basePath || dirOf(path),
  })
}

function handleLoad() {
  isLoading.value = false
  loaded.value = true
  postOpen()
}

watch(() => props.appParams?.absPath, (path, prev) => {
  if (!loaded.value || path === prev || launchOverride.value?.path === path)
    return
  postOpen()
})

onMounted(() => {
  window.addEventListener('message', bridge.handleMessage)
})

onBeforeUnmount(() => {
  window.removeEventListener('message', bridge.handleMessage)
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
      {{ $t('file_lite_i18n.loading') }} {{ plugin.name }}...
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
