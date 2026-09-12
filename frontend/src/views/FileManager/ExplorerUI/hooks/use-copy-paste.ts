import type { TaskItemResult, TaskSnapshot } from '@/types/server'
import { useSharedRef } from '@/hooks/use-shared-ref'
import { createTask, onTaskDone } from '@/store/tasks'
import { normalizeListingPath, normalizePath } from '../../utils'

const explorerStore = useSharedRef<{
  cutPaths: string[]
  copyPaths: string[]
  cutBasePath: string
}>('file-lite:explorer-copy-paste', {
  cutPaths: [],
  copyPaths: [],
  cutBasePath: '',
})

const MOVED_STATUSES = new Set(['moved', 'replaced', 'deleted'])

export function useCopyPaste({
  selectedPaths,
  basePath,
  isLoading,
}: {
  selectedPaths: Ref<string[]>
  basePath: Ref<string>
  isLoading: Ref<boolean>
}) {
  const enablePaste = computed(() => {
    return explorerStore.value.cutPaths.length > 0 || explorerStore.value.copyPaths.length > 0
  })

  /** 当前目录下被剪切的文件名集合（用于半透明样式） */
  const currentCutNames = computed(() => {
    const names = new Set<string>()
    for (const p of explorerStore.value.cutPaths) {
      const normalized = normalizePath(p)
      const name = normalized.split('/').pop()
      if (name && normalizePath(`${basePath.value}/${name}`) === normalized)
        names.add(name)
    }
    return names
  })

  const handleCut = () => {
    explorerStore.value.copyPaths = []
    explorerStore.value.cutPaths = [...selectedPaths.value]
    explorerStore.value.cutBasePath = normalizeListingPath(basePath.value)
  }

  const handleCopy = () => {
    explorerStore.value.cutPaths = []
    explorerStore.value.cutBasePath = ''
    explorerStore.value.copyPaths = [...selectedPaths.value]
  }

  /**
   * 粘贴改为提交服务端异步任务。冲突由服务端预扫描后通过 conflict 事件
   * 触发弹窗，这里不再做前端预检（列表可能是过期的）。
   */
  const handlePaste = async () => {
    const isMove = explorerStore.value.cutPaths.length > 0
    const paths = isMove ? [...explorerStore.value.cutPaths] : [...explorerStore.value.copyPaths]
    if (!paths.length) {
      return
    }

    isLoading.value = true
    try {
      const taskId = await createTask({
        kind: isMove ? 'move' : 'copy',
        fromPaths: paths,
        toPath: basePath.value,
        onConflict: 'ask',
      })
      onTaskDone(taskId, (task, results, truncated) => {
        applyClipboardResult({ isMove, task, results, truncated })
      })
    }
    catch (error: any) {
      isLoading.value = false
      window.$message?.error(error?.message || 'Failed to start the task')
      return
    }
    isLoading.value = false
  }

  /**
   * 任务结束后按结果更新剪贴板：
   * 取消 / 失败时保持原样（用户还能重试），移动只移除真正搬走的项。
   */
  function applyClipboardResult({
    isMove,
    task,
    results,
    truncated,
  }: {
    isMove: boolean
    task: TaskSnapshot
    results: TaskItemResult[]
    truncated: boolean
  }) {
    const finishedOk = task.state === 'succeeded' || task.state === 'partial'
    if (!finishedOk) {
      return
    }

    if (!isMove) {
      explorerStore.value.copyPaths = []
      return
    }

    if (truncated) {
      // 结果被截断时无法逐项判断，保守地清空剪贴板
      explorerStore.value.cutPaths = []
      explorerStore.value.cutBasePath = ''
      return
    }

    const moved = new Set(
      results.filter(item => MOVED_STATUSES.has(item.status)).map(item => item.fromPath),
    )
    const remaining = explorerStore.value.cutPaths.filter(path => !moved.has(path))
    explorerStore.value.cutPaths = remaining
    if (!remaining.length) {
      explorerStore.value.cutBasePath = ''
    }
  }

  return {
    enablePaste,
    handleCut,
    handleCopy,
    handlePaste,
    currentCutNames,
  }
}

/**
 * 拖拽移动完成后同步剪贴板：被搬走的路径要从剪切 / 复制两个列表里都摘掉。
 *
 * 复制列表也要清：用户可能先 Ctrl+C，随后又把它拖到别处；源已经不在原处了，
 * 之后再粘贴只会得到一个「源不存在」的失败。
 */
export function reconcileClipboardAfterMove(results: TaskItemResult[], truncated: boolean): void {
  if (truncated) {
    // 结果被截断时无法逐项判断，保守地清空两个列表
    explorerStore.value.cutPaths = []
    explorerStore.value.copyPaths = []
    explorerStore.value.cutBasePath = ''
    return
  }

  const moved = new Set(
    results.filter(item => MOVED_STATUSES.has(item.status)).map(item => item.fromPath),
  )
  if (!moved.size) {
    return
  }

  explorerStore.value.cutPaths = explorerStore.value.cutPaths.filter(path => !moved.has(path))
  explorerStore.value.copyPaths = explorerStore.value.copyPaths.filter(path => !moved.has(path))
  if (!explorerStore.value.cutPaths.length) {
    explorerStore.value.cutBasePath = ''
  }
}
