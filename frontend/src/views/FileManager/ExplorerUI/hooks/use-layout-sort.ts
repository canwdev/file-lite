import type { MenuItem } from '@imengyu/vue3-context-menu'
import type { IEntry } from '@server/types/server'
import { SortType } from '@server/types/server'
import { useStorage } from '@vueuse/core'
import { LsKeys } from '@/enum'
import { bytesToSize, formatDate } from '@/utils'
import { getFileIconClass } from '@/views/FileManager/ExplorerUI/file-icons'
import ThemedIcon from '@/views/FileManager/ExplorerUI/ThemedIcon.vue'
import { sortMethodMap } from '../../utils/sort'

export function useLayoutSort(files: Ref<IEntry[]>) {
  const isGridView = ref(false)
  const sortMode = ref(SortType.default)

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

  const tableColumns = computed((): Column[] => {
    return [
      { key: 'name', label: 'Name', width: 200, render: (item: IEntry) => {
        return h('div', { class: 'title-wrapper' }, [
          h(ThemedIcon, {
            iconClass: `mdi ${getFileIconClass(item)}`,
          }),
          h('span', {
            class: 'title-text',
            onClick: (e) => {
              e.stopPropagation()
              emit('open', { item })
            },
          }, item.name),
        ])
      }, sortModes: [SortType.name, SortType.nameDesc] },
      { key: 'ext', label: 'Ext', width: 50, formatter: (item: IEntry) => (item.ext || '').replace(/^\./, ''), sortModes: [SortType.extension, SortType.extensionDesc] },
      { key: 'size', label: 'Size', width: 80, formatter: (item: IEntry) => item.size === null ? '-' : bytesToSize(item.size), sortModes: [SortType.size, SortType.sizeDesc],
      },
      {
        key: 'lastModified',
        label: 'Last Modified',
        width: 140,
        formatter: (item: IEntry) => formatDate(item.lastModified),
        sortModes: [SortType.lastModified, SortType.lastModifiedDesc],
      },
      {
        key: 'birthtime',
        label: 'Created',
        width: 140,
        formatter: (item: IEntry) => formatDate(item.birthtime),
        sortModes: [SortType.birthTime, SortType.birthTimeDesc],
      },
    ].map((item) => {
      return {
        ...item,
        columnClick: () => {
          const idx = (item.sortModes || []).findIndex((m: SortType) => m === sortMode.value)
          const nextMode = idx + 1
          sortMode.value = item.sortModes[nextMode] || SortType.default
        },
        columnRightRender: () => {
          const idx = (item.sortModes || []).findIndex((m: SortType) => m === sortMode.value)
          const active = idx > -1
          const isDesc = idx > 0
          if (active) {
            return h('span', { class: `mdi ${isDesc ? 'mdi-menu-down' : 'mdi-menu-up'}`, style: 'line-height: 1; transform: scale(1.4)' })
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
    tableColumns,
  }
}
