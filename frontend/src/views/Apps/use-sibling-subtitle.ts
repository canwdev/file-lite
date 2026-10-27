import type { MaybeRefOrGetter } from 'vue'
import type { SubtitleSource } from './video-subtitle'
import { subscribeFsChanged } from '@/store/tasks'
import { normalizeListingPath } from '@/utils/path/form'
import { getFolderListingVersion } from '@/views/FileManager/ExplorerUI/folder-listing'
import { findSiblingFiles, mediaDirectory, SUBTITLE_DIR_NAMES } from './sibling-lookup'
import { SUBTITLE_EXTENSIONS, subtitleLabel } from './video-subtitle'

/**
 * 跟着视频路径找同名字幕，连同 `SRT/` 之类的字幕目录一起扫。
 *
 * 播放器 App 与 MediaPlayer 共用：传入路径的 ref / getter，换片时自动重找；找不到就是
 * 空数组——自动加载是尽力而为，不该因为一个不存在的字幕打扰用户。返回值直接接到
 * `NativeOrArtVideo` 的 `subtitles`，剩下两个播放器各自处理多份字幕。
 *
 * 视频没换也要重扫：资源管理器的主列表刷新（刷新按钮）会 +1 视频目录的缓存版本号，
 * `fs.changed` 则会通知目录或其下子目录（`SRT/`）的变化。这样在 File Lite 之外放进
 * 去的字幕，不用整页刷新也能挂到已经打开的播放器上。
 */
export function useSiblingSubtitles(videoPath: MaybeRefOrGetter<string>) {
  const subtitles = ref<SubtitleSource[]>([])
  /** 换片 / 重扫时旧请求可能后返回，用序号让它在途作废。 */
  let request = 0

  const dir = computed(() => mediaDirectory(toValue(videoPath)))
  /** 视频目录的缓存版本：主列表刷新与 `fs.changed` 都会 +1。 */
  const dirVersion = computed(() => (dir.value ? getFolderListingVersion(dir.value) : 0))
  /** `fs.changed` 发生在子目录（如 `SRT/`）时，父目录的版本号不会变，单独记一笔。 */
  const subdirVersion = ref(0)

  let unsubscribeFsChanged: () => void = () => {}
  watch(dir, (current) => {
    unsubscribeFsChanged()
    unsubscribeFsChanged = () => {}
    if (!current)
      return
    unsubscribeFsChanged = subscribeFsChanged((paths, changes) => {
      // listing 形态带结尾 `/`，所以 `/media/` 不会误配到 `/media2/`
      const underVideoDir = (path: string) => normalizeListingPath(path).startsWith(current)
      if (paths.some(underVideoDir) || changes.some(change => underVideoDir(change.dir)))
        subdirVersion.value += 1
    })
  }, { immediate: true })
  onScopeDispose(() => unsubscribeFsChanged())

  watch(() => [toValue(videoPath), dirVersion.value, subdirVersion.value] as const, async ([path], old) => {
    const current = ++request
    if (!path) {
      subtitles.value = []
      return
    }
    // 换片时旧字幕不再属于这个视频，先清掉；同一个视频的重扫则保留旧列表到新结果到达，
    // 否则播放器会看到「空 → 有」两次变化，用户关掉的字幕又会被自动打开。
    const sameVideo = !!old && old[0] === path
    if (!sameVideo)
      subtitles.value = []
    // 同一个视频又来了一次版本变化，说明是刷新 / `fs.changed` 触发的重扫：视频自己的目录
    // 在共用缓存里已经是新数据，但那次刷新没有重列 `SRT/`，子目录必须真的再读一次。
    const found = await findSiblingFiles(path, SUBTITLE_EXTENSIONS, SUBTITLE_DIR_NAMES, {
      refreshSubdirs: sameVideo,
    })
    if (current !== request)
      return
    const next = found.map(subtitlePath => ({
      path: subtitlePath,
      label: subtitleLabel(path, subtitlePath) || $t('file_lite_i18n.default'),
    }))
    // 内容没变就不换数组：`VArtPlayer` 用数组身份判断「这份字幕已经自动挂过」，
    // 新数组会让用户手动关掉的字幕在每次目录刷新后重新打开。
    if (sameSubtitleList(subtitles.value, next))
      return
    subtitles.value = next
  }, { immediate: true })

  return subtitles
}

function sameSubtitleList(a: SubtitleSource[], b: SubtitleSource[]): boolean {
  return a.length === b.length
    && a.every((item, index) => item.path === b[index]!.path && item.label === b[index]!.label)
}
