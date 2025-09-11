import {bytesToSize, formatDate} from '@/utils'
import {getFileIconClass} from '@/views/FileManager/ExplorerUI/file-icons'

export const useFileItem = (props) => {
  const {item} = toRefs(props)

  const iconClass = computed(() => {
    return `mdi ${getFileIconClass(item.value)}`
  })

  const titleDesc = computed(() => {
    return `Name: ${item.value.name}
Size: ${bytesToSize(item.value.size)}
Type: ${item.value.mimeType || '-'}
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
