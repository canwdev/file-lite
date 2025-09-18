<script lang="ts" setup>
import PlayerCore from './PlayerCore.vue'
import MusicControl from './MusicControl.vue'
import MusicPlaylist from './Playlist/index.vue'
import {MediaItem} from './utils/music-state'
import {isSupportedMediaFormat} from '@/utils/is'
import FoldableSidebarLayout from '@canwdev/vgo-ui/src/components/Layouts/FoldableSidebarLayout.vue'
import {useMediaStore} from './utils/media-store'
import {guid} from '@/utils'
import {AppParams} from '@/views/Apps/apps.ts'

const props = withDefaults(
  defineProps<{
    appParams: AppParams
  }>(),
  {},
)

// const {params} = toRefs(props)

const storeId = ref(`mediaStore_${guid()}`)
// 向所有子组件传参
provide('storeId', storeId)

const mediaStore = useMediaStore(storeId.value)

// 应用启动传参
watch(
  () => props.appParams,
  () => {
    console.log(props.appParams)
    if (!props.appParams) {
      return
    }
    const {item, list, basePath} = props.appParams
    const medias = list
      .map((i) => new MediaItem(i.name, basePath))
      .filter((i) => {
        return isSupportedMediaFormat(i.filename)
      })
    const idx = medias.findIndex((i) => i.filename === item.name)

    mediaStore.playFromList(medias, idx)
  },
  {immediate: true},
)
</script>

<template>
  <div class="media-player-wrap">
    <div class="music-above">
      <FoldableSidebarLayout>
        <template #sidebar>
          <MusicPlaylist />
        </template>
        <template #default>
          <div class="media-detail">
            <PlayerCore />
          </div>
        </template>
      </FoldableSidebarLayout>
    </div>
    <div class="music-below">
      <MusicControl />
    </div>
  </div>
</template>

<style lang="scss" scoped>
.media-player-wrap {
  height: 100%;
  display: flex;
  flex-direction: column;
  .music-above {
    flex: 1;
    overflow: hidden;
  }
  .media-detail {
    height: 100%;
  }
  .music-below {
    height: 75px;
  }
}
</style>
