import { LsKeys } from '@/enum'
import { useRemoteSetting } from '@/hooks/use-remote-setting'
import { normalizeListingPath, toggleArrayElement } from '../../utils'

/**
 * 收藏夹是全局一份的状态：侧边栏、每个标签的地址栏收藏按钮都读它。
 *
 * `useRemoteSetting` 每次调用都会新建一个 ref（各自订阅、各自回写），所以必须在这里
 * 只建一次再共享 —— 否则每个标签各持一份收藏列表，改一个要等服务端广播才同步到其余。
 */
const { state: starList } = useRemoteSetting<string[]>({
  key: LsKeys.STARED_PATH,
  createDefaultValue: () => [],
  normalize: value => Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [],
})

export function useFavourites() {
  function isStared(path: string) {
    return starList.value.includes(normalizeListingPath(path))
  }

  function toggleStar(path: string) {
    starList.value = toggleArrayElement([...starList.value], normalizeListingPath(path))
  }

  function removeStarredPath(path: string) {
    starList.value = starList.value.filter(item => item !== path)
  }

  return {
    starList,
    isStared,
    toggleStar,
    removeStarredPath,
  }
}
