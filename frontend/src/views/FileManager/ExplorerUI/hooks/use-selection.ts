import type { Ref } from 'vue'
import type { IEntry } from '@/types/server'
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { useSelectionArea } from '@/hooks/use-selection-area'
import { normalizePath, toggleArrayElement } from '../../utils'

export interface SelectionRect {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

export function useSelection({
  files,
  basePath,
  allowMultipleSelection,
  selectables = ['.selectable'],
  getItemsInSelectionRect,
}: {
  files: Ref<IEntry[]>
  basePath: Ref<string>
  allowMultipleSelection: Ref<boolean>
  selectables: string[]
  getItemsInSelectionRect?: (rect: SelectionRect) => IEntry[]
}) {
  const selectedItemsSet = ref(new Set<IEntry>())

  const clearSelection = () => {
    selectedItemsSet.value = new Set()
  }

  watch(files, () => {
    clearSelection()
  })

  const explorerContentRef = ref<HTMLElement | null>(null)
  const selectionRect = ref<SelectionRect | null>(null)
  const selectionRef = getItemsInSelectionRect
    ? shallowRef()
    : useSelectionArea({
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
  let selectionStart: { x: number, y: number } | null = null
  let selectionBaseSet = new Set<IEntry>()
  let hasDraggedSelection = false
  let appendSelection = false
  let ignoreNextContentClick = false
  let autoScrollFrame = 0
  let lastMoveEvent: MouseEvent | null = null

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

  const selectionBoxStyle = computed(() => {
    if (!selectionRect.value) {
      return undefined
    }
    return {
      left: `${selectionRect.value.left}px`,
      top: `${selectionRect.value.top}px`,
      width: `${selectionRect.value.width}px`,
      height: `${selectionRect.value.height}px`,
    }
  })

  function handleContentMouseDown(event: MouseEvent) {
    if (!getItemsInSelectionRect || !allowMultipleSelection.value || event.button !== 0) {
      return
    }

    const target = event.target as HTMLElement | null
    if (!canStartSelectionDrag(target)) {
      return
    }

    const point = getContentPoint(event)
    if (!point) {
      return
    }

    appendSelection = event.ctrlKey || event.metaKey
    selectionStart = point
    selectionBaseSet = appendSelection ? new Set(selectedItemsSet.value) : new Set()
    hasDraggedSelection = false
    lastMoveEvent = event
    document.addEventListener('mousemove', handleSelectionMove)
    document.addEventListener('mouseup', handleSelectionStop)
  }

  function handleContentClick() {
    if (ignoreNextContentClick) {
      ignoreNextContentClick = false
      return
    }
    clearSelection()
  }

  function handleContentClickCapture(event: MouseEvent) {
    if (!ignoreNextContentClick) {
      return
    }

    ignoreNextContentClick = false
    event.preventDefault()
    event.stopImmediatePropagation()
  }

  function handleSelectionMove(event: MouseEvent) {
    if (!selectionStart) {
      return
    }

    lastMoveEvent = event
    const point = getContentPoint(event)
    if (!point) {
      return
    }

    const deltaX = Math.abs(point.x - selectionStart.x)
    const deltaY = Math.abs(point.y - selectionStart.y)
    if (!hasDraggedSelection && deltaX < 3 && deltaY < 3) {
      return
    }

    hasDraggedSelection = true
    selectionRect.value = createSelectionRect(selectionStart, point)
    updateSelectionFromRect()
    scheduleAutoScroll()
  }

  function handleSelectionStop() {
    stopAutoScroll()
    document.removeEventListener('mousemove', handleSelectionMove)
    document.removeEventListener('mouseup', handleSelectionStop)

    if (hasDraggedSelection) {
      ignoreNextContentClick = true
    }

    selectionStart = null
    selectionBaseSet = new Set()
    hasDraggedSelection = false
    selectionRect.value = null
  }

  function updateSelectionFromRect() {
    if (!selectionRect.value || !getItemsInSelectionRect) {
      return
    }

    const nextSet = new Set(selectionBaseSet)
    getItemsInSelectionRect(selectionRect.value).forEach(item => nextSet.add(item))
    selectedItemsSet.value = nextSet
  }

  function getContentPoint(event: MouseEvent) {
    const el = explorerContentRef.value
    if (!el) {
      return null
    }

    const rect = el.getBoundingClientRect()
    return {
      x: event.clientX - rect.left + el.scrollLeft,
      y: event.clientY - rect.top + el.scrollTop,
    }
  }

  function scheduleAutoScroll() {
    if (autoScrollFrame) {
      return
    }
    autoScrollFrame = requestAnimationFrame(autoScroll)
  }

  function autoScroll() {
    autoScrollFrame = 0
    const el = explorerContentRef.value
    const event = lastMoveEvent
    if (!el || !event || !selectionStart || !hasDraggedSelection) {
      return
    }

    const rect = el.getBoundingClientRect()
    const edgeSize = 48
    let scrollDelta = 0
    if (event.clientY < rect.top + edgeSize) {
      scrollDelta = -Math.ceil((rect.top + edgeSize - event.clientY) / 3)
    }
    else if (event.clientY > rect.bottom - edgeSize) {
      scrollDelta = Math.ceil((event.clientY - rect.bottom + edgeSize) / 3)
    }

    if (scrollDelta) {
      el.scrollTop += scrollDelta
      const point = getContentPoint(event)
      if (point) {
        selectionRect.value = createSelectionRect(selectionStart, point)
        updateSelectionFromRect()
      }
      scheduleAutoScroll()
    }
  }

  function stopAutoScroll() {
    if (autoScrollFrame) {
      cancelAnimationFrame(autoScrollFrame)
      autoScrollFrame = 0
    }
  }

  onBeforeUnmount(() => {
    stopAutoScroll()
    document.removeEventListener('mousemove', handleSelectionMove)
    document.removeEventListener('mouseup', handleSelectionStop)
  })

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
    selectionBoxStyle,
    handleContentMouseDown,
    handleContentClick,
    handleContentClickCapture,
    clearSelection,
    toggleSelect,
    isAllSelected,
    selectByNames,
    toggleSelectAll,
    selectedPaths,
  }
}

function canStartSelectionDrag(target: HTMLElement | null) {
  if (!target) {
    return true
  }

  return !target.closest(
    'a, input, textarea, select, .resizer, .checkbox-col, .file-checkbox, .checkbox',
  )
}

function createSelectionRect(
  start: { x: number, y: number },
  current: { x: number, y: number },
): SelectionRect {
  const left = Math.min(start.x, current.x)
  const top = Math.min(start.y, current.y)
  const right = Math.max(start.x, current.x)
  const bottom = Math.max(start.y, current.y)
  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
  }
}
