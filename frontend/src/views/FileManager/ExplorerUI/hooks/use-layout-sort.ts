import type { MenuItem } from '@imengyu/vue3-context-menu'
import type { GroupField } from '../../utils/group'
import type { SortField } from '../../utils/sort'
import type { IEntry, SortType } from '@/types/server'
import { localSettingsStore } from '@/store'
import { preferredGroupDesc } from '../../utils/group'
import { composeSortMode, parseSortMode, SORT_FIELD_LABELS, SORT_FIELDS, sortEntries } from '../../utils/sort'

const SORT_FIELD_ITEMS: { label: string, field: SortField }[] = SORT_FIELDS.map(field => ({
  label: SORT_FIELD_LABELS[field],
  field,
}))

function checkIcon(active: boolean) {
  return active ? 'mdi mdi-check' : ''
}

export function useLayoutSort(
  files: Ref<IEntry[]>,
  sortMode: Ref<SortType>,
  showHidden: Ref<boolean>,
) {
  const sortOptions = computed((): MenuItem[] => {
    const { field, desc } = parseSortMode(sortMode.value)
    const fieldItems: MenuItem[] = SORT_FIELD_ITEMS.map((item, index) => ({
      label: item.label,
      icon: checkIcon(field === item.field),
      divided: index === SORT_FIELD_ITEMS.length - 1,
      onClick: () => {
        sortMode.value = composeSortMode(item.field, desc)
      },
    }))

    return [
      ...fieldItems,
      {
        label: 'Ascending',
        icon: checkIcon(!desc),
        onClick: () => {
          sortMode.value = composeSortMode(field, false)
        },
      },
      {
        label: 'Descending',
        icon: checkIcon(desc),
        onClick: () => {
          sortMode.value = composeSortMode(field, true)
        },
      },
    ]
  })
  const sortedFiles = computed(() =>
    sortEntries(files.value, sortMode.value, showHidden.value, localSettingsStore.value.sortFoldersFirst),
  )

  return {
    sortOptions,
    sortedFiles,
  }
}

export function useLayoutGroup(
  groupField: Ref<GroupField>,
  groupDesc: Ref<boolean>,
  onFieldChange?: () => void,
) {
  const groupOptions = computed((): MenuItem[] => {
    const field = groupField.value
    const desc = groupDesc.value
    const fieldItems: MenuItem[] = SORT_FIELD_ITEMS.map(item => ({
      label: item.label,
      icon: checkIcon(field === item.field),
      onClick: () => {
        if (item.field === field)
          return
        if (field === 'none')
          groupDesc.value = preferredGroupDesc(item.field)
        groupField.value = item.field
        onFieldChange?.()
      },
    }))

    return [
      ...fieldItems,
      {
        label: '(None)',
        icon: checkIcon(field === 'none'),
        divided: true,
        onClick: () => {
          if (field === 'none')
            return
          groupField.value = 'none'
          onFieldChange?.()
        },
      },
      {
        label: 'Ascending',
        icon: checkIcon(!desc),
        onClick: () => {
          groupDesc.value = false
        },
      },
      {
        label: 'Descending',
        icon: checkIcon(desc),
        onClick: () => {
          groupDesc.value = true
        },
      },
    ]
  })

  return { groupOptions }
}
