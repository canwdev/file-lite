import {sortMethodMap} from '../../utils/sort'
import {SortType} from '@server/types/server'
import {LsKeys} from '@/enum'
import {useStorage} from '@vueuse/core'
import {IEntry} from '@server/types/server'
import {MenuItem} from '@imengyu/vue3-context-menu'

export const useLayoutSort = (files: Ref<IEntry[]>) => {
  const isGridView = ref(false)
  const sortMode = ref(SortType.default)

  const sortOptions = computed((): MenuItem[] => {
    return [
      {label: 'Default', value: SortType.default},
      {label: 'Name ▲', value: SortType.name},
      {label: 'Name ▼', value: SortType.nameDesc},
      {label: 'Extension ▲', value: SortType.extension},
      {label: 'Extension ▼', value: SortType.extensionDesc},
      {label: 'Size ▲', value: SortType.size},
      {label: 'Size ▼', value: SortType.sizeDesc},
      {label: 'Last Modified ▲', value: SortType.lastModified},
      {label: 'Last Modified ▼', value: SortType.lastModifiedDesc},
      {label: 'Created Time ▲', value: SortType.birthTime},
      {label: 'Created Time ▼', value: SortType.birthTimeDesc},
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
  const showHidden = useStorage(LsKeys.SHOW_HIDDEN_FILES, false)
  const filteredFiles = computed(() => {
    return files.value
      .filter((item) => {
        if (showHidden.value) {
          return true
        }
        return !item.hidden
      })
      .sort(sortMethodMap[sortMode.value])
  })

  const sortableListHeader = computed(() => {
    return [
      {label: 'Name', className: 'c-filename', sortModes: [SortType.name, SortType.nameDesc]},
      {label: 'Ext', className: 'c-ext', sortModes: [SortType.extension, SortType.extensionDesc]},
      {label: 'Size', className: 'c-size', sortModes: [SortType.size, SortType.sizeDesc]},
      {
        label: 'Last Modified',
        className: 'c-time',
        sortModes: [SortType.lastModified, SortType.lastModifiedDesc],
      },
      {
        label: 'Created',
        className: 'c-time',
        sortModes: [SortType.birthTime, SortType.birthTimeDesc],
      },
    ].map((item) => {
      const idx = item.sortModes.findIndex((m: SortType) => m === sortMode.value)
      return {
        ...item,
        active: idx > -1,
        isDesc: idx > 0,
        onClick: () => {
          const nextMode = idx + 1
          if (nextMode > item.sortModes.length) {
            sortMode.value = SortType.default
          } else {
            sortMode.value = item.sortModes[nextMode]
          }
        },
      }
    })
  })

  return {
    isGridView,
    sortMode,
    sortOptions,
    filteredFiles,
    showHidden,
    sortableListHeader,
  }
}
