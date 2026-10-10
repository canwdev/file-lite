import type { IEntry } from '@/types/server'
import { bytesToSize, formatDate } from '@/utils'
import { getFileIconClass } from '@/views/FileManager/ExplorerUI/file-icons'

export function getTooltip(item: IEntry) {
  return [
    {
      label: $t('file_lite_i18n.name'),
      value: item.name,
    },
    {
      label: $t('file_lite_i18n.size'),
      value: item.size === null ? '' : bytesToSize(item.size),
    },
    {
      label: $t('file_lite_i18n.modified'),
      value: formatDate(item.lastModified, 'YYYY-MM-DD HH:mm:ss'),
    },
    {
      label: $t('file_lite_i18n.created'),
      value: formatDate(item.birthtime, 'YYYY-MM-DD HH:mm:ss'),
    },
    {
      label: $t('file_lite_i18n.error'),
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
