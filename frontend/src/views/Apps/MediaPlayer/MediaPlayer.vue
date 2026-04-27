<script lang="ts" setup>
import type { AppParams } from '@/views/Apps/apps.ts'
import { guid } from '@/utils'
import { isSupportedMediaFormat } from '@/utils/is'
import MusicControl from './MusicControl.vue'
import PlayerCore from './PlayerCore.vue'
import MusicPlaylist from './Playlist/index.vue'
import { useMediaStore } from './utils/media-store'
import { MediaItem } from './utils/music-state'

const props = withDefaults(
  defineProps<{
    appParams: AppParams
  }>(),
  {},
)
const emit = defineEmits<{
  (e: 'locateItem', name: string): void
}>()

// const {params} = toRefs(props)

const storeId = ref(`mediaStore_${guid()}`)
// 向所有子组件传参
provide('storeId', storeId)

const mediaStore = useMediaStore(storeId.value)

// 应用启动传参
watch(
  () => props.appParams,
  () => {
    if (!props.appParams) {
      return
    }
    const { item, list, basePath } = props.appParams
    const medias = list
      .map(i => new MediaItem(i.name, basePath))
      .filter((i) => {
        return isSupportedMediaFormat(i.filename)
      })
    const idx = medias.findIndex(i => i.filename === item.name)

    mediaStore.playFromList(medias, idx)
  },
  { immediate: true },
)
</script>

<template>
  <div class="media-player-wrap">
    <div class="music-above">
      <el-splitter lazy>
        <el-splitter-panel size="230px" collapsible>
          <MusicPlaylist @locate-item="(name: string) => emit('locateItem', name)" />
        </el-splitter-panel>
        <el-splitter-panel collapsible>
          <div class="media-detail">
            <PlayerCore />
          </div>
        </el-splitter-panel>
      </el-splitter>
    </div>
    <!-- 视频模式无底部控制条，音量/倍速不与 VArt 内持久化抢写 Pinia -->
    <div v-if="!mediaStore.isVideo" class="music-below">
      <MusicControl />
    </div>
  </div>
</template>

<style lang="scss" scoped>
$music-control-bar-height: 75px;

.media-player-wrap {
  height: 100%;
  display: flex;
  flex-direction: column;
  // border-top: 1px solid var(--vgo-color-border);
  .music-above {
    flex: 1;
    overflow: hidden;
    min-height: 0;
  }
  .media-detail {
    overflow: hidden;
    height: 100%;
    position: relative;
  }
  .music-below {
    height: $music-control-bar-height;
    flex-shrink: 0;
  }
}
</style>
