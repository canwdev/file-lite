import type { Ref } from 'vue'
import type { IEntry } from '@/types/server'
import { computed, ref, watch } from 'vue'
import { useSelectionArea } from '@/hooks/use-selection-area'
import { normalizePath, toggleArrayElement } from '../../utils'

export function useSelection({
  files,
  basePath,
  allowMultipleSelection,
  selectables = ['.selectable'],
}: {
  files: Ref<IEntry[]>
  basePath: Ref<string>
  allowMultipleSelection: Ref<boolean>
  selectables: string[]
}) {
  const selectedItemsSet = ref(new Set<IEntry>())

  const clearSelection = () => {
    selectedItemsSet.value.clear()
  }

  watch(files, () => {
    clearSelection()
  })

  const explorerContentRef = ref<HTMLElement | null>(null)
  const selectionRef = useSelectionArea({
    containerRef: explorerContentRef,
    onStart: () => {
      clearSelection()
    },
    onStop: (stored) => {
      const map: Record<string, IEntry> = {}
      files.value.forEach((i) => {
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

      clearSelection()
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
      clearSelection()
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
        idx = files.value.findIndex(i => i.name === first.name)
      }
      let itemIdx = files.value.findIndex(i => i.name === item.name)
      if (idx > itemIdx) {
        // 使最小的index在最前
        ;[itemIdx, idx] = [idx, itemIdx]
      }
      selectedItemsSet.value = new Set(files.value.slice(idx, itemIdx + 1))
    }
    else {
      clearSelection()
      selectedItemsSet.value.add(item)
    }
  }

  const isAllSelected = computed(() => {
    const allFiles = files.value
    if (!allFiles.length) {
      return false
    }
    return selectedItemsSet.value.size === allFiles.length
  })

  const toggleSelectAll = () => {
    if (!allowMultipleSelection.value) {
      return
    }
    const allFiles = files.value
    if (isAllSelected.value) {
      clearSelection()
    }
    else {
      selectedItemsSet.value = new Set(allFiles)
    }
  }

  const selectByNames = (names: string[]) => {
    clearSelection()
    const map = new Map(files.value.map(i => [i.name, i]))
    for (const name of names) {
      const item = map.get(name)
      if (item) {
        selectedItemsSet.value.add(item)
      }
    }
  }

  const selectedItems = computed(() => {
    return [...selectedItemsSet.value]
  })

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

  return {
    selectedItemsSet,
    selectedItemsSize,
    selectedItems,
    explorerContentRef,
    toggleSelect,
    isAllSelected,
    selectByNames,
    toggleSelectAll,
    selectedPaths,
  }
}
