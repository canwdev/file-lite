import type { IEntry } from '@server/types/server'
import { bytesToSize, formatDate } from '@/utils'
import { getFileIconClass } from '@/views/FileManager/ExplorerUI/file-icons'

export function getTooltip(item: IEntry) {
  return [
    {
      label: 'Name',
      value: item.name,
    },
    {
      label: 'Size',
      value: item.size === null ? '' : bytesToSize(item.size),
    },
    {
      label: 'Last Modified',
      value: formatDate(item.lastModified, 'YYYY-MM-DD HH:mm:ss'),
    },
    {
      label: 'Created',
      value: formatDate(item.birthtime, 'YYYY-MM-DD HH:mm:ss'),
    },
    {
      label: 'Error',
      value: item.error || null,
    },
  ].filter(i => !!i.value).map(i => `${i.label}: ${i.value}`).join('\n')
}

export function useFileItem(props: { item: IEntry }) {
  const { item } = toRefs(props)

  const iconClass = computed(() => {
    return `mdi ${getFileIconClass(item.value)}`
  })

  const titleDesc = computed(() => {
    return getTooltip(item.value)
  })

  const extDisplay = computed(() => {
    return (item.value.ext || '').replace(/^\./, '')
  })

  const nameDisplay = computed(() => {
    return item.value.name
  })

  return {
    iconClass,
    titleDesc,
    extDisplay,
    nameDisplay,
  }
}
