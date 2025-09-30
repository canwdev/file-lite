import type { IEntry } from '@server/types/server'
import { bytesToSize, formatDate } from '@/utils'
import { getFileIconClass } from '@/views/FileManager/ExplorerUI/file-icons'

export function useFileItem(props: { item: IEntry }) {
  const { item } = toRefs(props)

  const iconClass = computed(() => {
    return `mdi ${getFileIconClass(item.value)}`
  })

  const titleDesc = computed(() => {
    return `Name: ${item.value.name}
Size: ${item.value.size === null ? '-' : bytesToSize(item.value.size)}
Last Modified: ${formatDate(item.value.lastModified, 'YYYY-MM-DD HH:mm:ss')}
Created: ${formatDate(item.value.birthtime, 'YYYY-MM-DD HH:mm:ss')}
`
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
