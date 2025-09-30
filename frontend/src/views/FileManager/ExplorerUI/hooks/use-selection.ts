import type { IEntry } from '@server/types/server'
import { useSelectionArea } from '@/hooks/use-selection-area'
import { normalizePath, toggleArrayElement } from '../../utils'

export function useSelection({
  filteredFiles,
  basePath,
  allowMultipleSelection,
  selectables = ['.selectable'],
}: {
  filteredFiles: Ref<IEntry[]>
  basePath: Ref<string>
  allowMultipleSelection: Ref<boolean>
  selectables: string[]
}) {
  const selectedItemsSet = ref(new Set<IEntry>())
  watch(filteredFiles, () => {
    selectedItemsSet.value.clear()
  })

  const explorerContentRef = ref()
  const selectionRef = useSelectionArea({
    containerRef: explorerContentRef,
    onStart: () => {
      selectedItemsSet.value.clear()
    },
    onStop: (stored) => {
      const map: Record<string, IEntry> = {}
      filteredFiles.value.forEach((i) => {
        map[i.name] = i
      })
      const list: IEntry[] = []
      stored.forEach((el) => {
        const name = el.getAttribute('data-name')
        if (!name) {
          return
        }
        if (map[name]) {
          list.push(map[name])
        }
      })

      selectedItemsSet.value.clear()
      list.forEach((i) => {
        selectedItemsSet.value.add(i)
      })
    },
    selectables,
  })

  watch(
    allowMultipleSelection,
    (val) => {
      setTimeout(() => {
        // console.log(selectionRef, selectionRef.value, val)
        if (!selectionRef.value) {
          return
        }
        if (val) {
          selectionRef.value.enable()
        }
        else {
          selectionRef.value.disable()
        }
      })
    },
    { immediate: true },
  )

  const toggleSelect = ({
    item,
    event,
    toggle = false,
  }: {
    item: IEntry
    event: MouseEvent
    toggle?: boolean
  }) => {
    if (!allowMultipleSelection.value) {
      selectedItemsSet.value.clear()
      selectedItemsSet.value.add(item)
      return
    }
    if (event.ctrlKey || event.metaKey || toggle) {
      // 使用ctrl键多选
      selectedItemsSet.value = new Set(toggleArrayElement(selectedItems.value, item))
    }
    else if (event.shiftKey) {
      // 使用shift键选择范围
      let idx = 0
      const first = selectedItems.value[0]
      if (first) {
        idx = filteredFiles.value.findIndex(i => i.name === first.name)
      }
      let itemIdx = filteredFiles.value.findIndex(i => i.name === item.name)
      if (idx > itemIdx) {
        // 使最小的index在最前
        ;[itemIdx, idx] = [idx, itemIdx]
      }
      selectedItemsSet.value = new Set(filteredFiles.value.slice(idx, itemIdx + 1))
    }
    else {
      selectedItemsSet.value.clear()
      selectedItemsSet.value.add(item)
    }
  }

  const isAllSelected = computed(() => {
    const allFiles = filteredFiles.value
    if (!allFiles.length) {
      return false
    }
    return selectedItemsSet.value.size === allFiles.length
  })

  const toggleSelectAll = () => {
    if (!allowMultipleSelection.value) {
      return
    }
    const allFiles = filteredFiles.value
    if (isAllSelected.value) {
      selectedItemsSet.value.clear()
    }
    else {
      selectedItemsSet.value = new Set(allFiles)
    }
  }

  const selectedPaths = computed(() => {
    return selectedItems.value.map((item) => {
      return normalizePath(`${basePath.value}/${item.name}`)
    })
  })

  const selectedItemsSize = computed(() => {
    return selectedItems.value.reduce((pv, nv) => {
      const { size, isDirectory } = nv
      if (isDirectory) {
        return Number.NaN
      }
      return pv + (size || 0)
    }, 0)
  })

  const selectedItems = computed(() => {
    return [...selectedItemsSet.value]
  })

  return {
    selectedItemsSet,
    selectedItemsSize,
    selectedItems,
    explorerContentRef,
    toggleSelect,
    isAllSelected,
    toggleSelectAll,
    selectedPaths,
  }
}
