import type { MenuItem } from '@imengyu/vue3-context-menu'
import type { IEntry } from '@/types/server'
import { SortType } from '@/types/server'
import { useStorage } from '@vueuse/core'
import { LsKeys } from '@/enum'
import { sortMethodMap } from '../../utils/sort'

export function useLayoutSort(files: Ref<IEntry[]>, sortMode: Ref<SortType>) {
  const isGridView = ref(false)

  const sortOptions = computed((): MenuItem[] => {
    return [
      { label: 'Default', value: SortType.default },
      { label: 'Name ▲', value: SortType.name },
      { label: 'Name ▼', value: SortType.nameDesc },
      { label: 'Extension ▲', value: SortType.extension },
      { label: 'Extension ▼', value: SortType.extensionDesc },
      { label: 'Size ▲', value: SortType.size },
      { label: 'Size ▼', value: SortType.sizeDesc },
      { label: 'Last Modified ▲', value: SortType.lastModified },
      { label: 'Last Modified ▼', value: SortType.lastModifiedDesc },
      { label: 'Created Time ▲', value: SortType.birthTime },
      { label: 'Created Time ▼', value: SortType.birthTimeDesc },
    ].map((i) => {
      return {
        label: i.label,
        icon: sortMode.value === i.value ? 'mdi mdi-check' : '',
        onClick: () => {
          sortMode.value = i.value
        },
      }
    })
  })
  const showHidden = useStorage(LsKeys.SHOW_HIDDEN_FILES, false, localStorage, {
    listenToStorageChanges: false,
  })
  const sortedFiles = computed(() => {
    return files.value
      .filter((item) => {
        if (showHidden.value) {
          return true
        }
        return !item.hidden && !item.error
      })
      .sort(sortMethodMap[sortMode.value])
  })

  return {
    isGridView,
    sortOptions,
    sortedFiles,
    showHidden,
  }
}
