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
  isLoading,
  allowMultipleSelection,
  selectables = ['.selectable'],
  getItemsInSelectionRect,
}: {
  files: Ref<IEntry[]>
  basePath: Ref<string>
  isLoading?: Ref<boolean>
  allowMultipleSelection: Ref<boolean>
  selectables: string[]
  getItemsInSelectionRect?: (rect: SelectionRect) => IEntry[]
}) {
  const selectedItemsSet = ref(new Set<IEntry>())
  const selectedItemPaths = ref(new Set<string>())
  let reconcilingSelection = false

  const clearSelection = () => {
    selectedItemsSet.value = new Set()
    selectedItemPaths.value = new Set()
  }

  function syncSelectedPaths() {
    selectedItemPaths.value = new Set([...selectedItemsSet.value].map(item => item.path))
  }

  function setSelection(items: Iterable<IEntry>) {
    selectedItemsSet.value = new Set(items)
    syncSelectedPaths()
  }

  watch(selectedItemsSet, () => {
    if (!reconcilingSelection) {
      syncSelectedPaths()
    }
  }, { deep: true, flush: 'sync' })

  function reconcileSelection(nextFiles: IEntry[]) {
    if (!selectedItemPaths.value.size) {
      return
    }

    if (!nextFiles.length) {
      reconcilingSelection = true
      selectedItemsSet.value = new Set()
      reconcilingSelection = false

      if (!isLoading?.value) {
        selectedItemPaths.value = new Set()
      }
      return
    }

    // Identity is the canonical path: a branch listing can hold several files
    // with the same basename in different subfolders.
    const nextSelection = nextFiles.filter(item => selectedItemPaths.value.has(item.path))
    reconcilingSelection = true
    selectedItemsSet.value = new Set(nextSelection)
    reconcilingSelection = false
    if (isLoading?.value && !nextSelection.length) {
      return
    }
    syncSelectedPaths()
  }

  watch(files, (nextFiles) => {
    reconcileSelection(nextFiles)
  })

  watch(() => isLoading?.value, (loading) => {
    if (loading === false) {
      reconcileSelection(files.value)
    }
  })

  watch(basePath, () => {
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
          const byPath = new Map(files.value.map(entry => [entry.path, entry]))
          const list: IEntry[] = []
          stored.forEach((el) => {
            const path = el.getAttribute('data-path')
            const item = path ? byPath.get(path) : undefined
            if (item) {
              list.push(item)
            }
          })

          setSelection(list)
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
    setSelection(nextSet)
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
      setSelection([item])
      return
    }
    if (event.ctrlKey || event.metaKey || toggle) {
      // 使用ctrl键多选
      setSelection(toggleArrayElement(selectedItems.value, item))
    }
    else if (event.shiftKey) {
      // 使用shift键选择范围
      let idx = 0
      const first = selectedItems.value[0]
      if (first) {
        idx = files.value.findIndex(i => i.path === first.path)
      }
      let itemIdx = files.value.findIndex(i => i.path === item.path)
      if (idx > itemIdx) {
        // 使最小的index在最前
        ;[itemIdx, idx] = [idx, itemIdx]
      }
      setSelection(files.value.slice(idx, itemIdx + 1))
    }
    else {
      setSelection([item])
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
      setSelection(allFiles)
    }
  }

  const selectByNames = (names: string[]) => {
    const map = new Map(files.value.map(i => [i.name, i]))
    const items: IEntry[] = []
    for (const name of names) {
      const item = map.get(name)
      if (item) {
        items.push(item)
      }
    }
    setSelection(items)
  }

  const selectByPaths = (paths: string[]) => {
    const map = new Map(files.value.map(i => [i.path, i]))
    const items: IEntry[] = []
    for (const path of paths) {
      const item = map.get(path)
      if (item) {
        items.push(item)
      }
    }
    setSelection(items)
  }

  const selectedItems = computed(() => {
    return [...selectedItemsSet.value]
  })

  const selectedPaths = computed(() => {
    // In a recursive (branch) listing `name` is only the basename, so the
    // canonical full path must come from the entry itself.
    return selectedItems.value.map(item => normalizePath(item.path))
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
    selectByPaths,
    toggleSelectAll,
    selectedPaths,
  }
}

function canStartSelectionDrag(target: HTMLElement | null) {
  if (!target) {
    return true
  }

  // `.selectable`（行 / 网格项）上按下是准备原生拖拽，不能同时发起框选：
  // 原生拖拽期间浏览器不再派发 mousemove / mouseup，框选会永远停在半路。
  return !target.closest(
    'a, input, textarea, select, .resizer, .checkbox-col, .file-checkbox, .checkbox, .selectable',
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
