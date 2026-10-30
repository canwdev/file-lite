<script setup lang="ts">
import type { AppParams } from './apps'
import type { AppWindowState } from './apps-store'
import type { SdkLaunch } from '@/sdk/contract'
import { createAppSdk, FILE_LITE_SDK_KEY } from '@/sdk/use-app-sdk'
import { fs } from '@/utils/fs'
import { launchFromParams, openEventFromParams, paramsFromLaunch } from './app-launch'

const props = defineProps<{
  win: AppWindowState
}>()

const emit = defineEmits<{
  setTitle: [title: string]
  exit: []
  selectItems: [names: string[]]
  locateItem: [name: string]
  updateAppParams: [params: AppParams]
}>()

/** `updateLaunch` must not push `onOpen` back into the app that called it. */
let skipNextOpen = false

const transport = createAppSdk({
  getLaunch: () => {
    const launch = launchFromParams(props.win.data.appParams)
    return launch.path ? launch : null
  },
  setLaunch: (launch: SdkLaunch) => {
    skipNextOpen = true
    emit('updateAppParams', paramsFromLaunch(launch, props.win.data.appParams))
  },
  close: () => emit('exit'),
  setTitle: (title: string) => emit('setTitle', title),
  selectItems: (names: string[]) => emit('selectItems', names),
  revealItem: (name: string) => emit('locateItem', name),
}, fs)

provide(FILE_LITE_SDK_KEY, transport.sdk)

watch(
  () => props.win.data.appParams,
  (params) => {
    if (skipNextOpen) {
      skipNextOpen = false
      return
    }
    transport.emitOpen(openEventFromParams(params))
  },
)

onMounted(() => {
  transport.emitOpen(openEventFromParams(props.win.data.appParams))
})
</script>

<template>
  <slot />
</template>
