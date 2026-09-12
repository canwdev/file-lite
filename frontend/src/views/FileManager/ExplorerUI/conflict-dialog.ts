import type { ConflictPolicy } from '@/types/server'
import { computed, ref, watch } from 'vue'
import { conflictDialogVisible, conflictQueue, resolveConflict } from '@/store/tasks'

/**
 * 冲突弹窗的交互状态，对齐 Windows 资源管理器的
 * 「Replace or Skip Files」对话框：
 * - 只有一个冲突时：直接选 Replace / Skip
 * - 有多个冲突且未勾选「应用于全部」时：逐个文件询问
 * - 勾选「应用于全部」时：一次决策应用到所有冲突
 */
export function useConflictDialog() {
  const request = computed(() => conflictQueue.value[0] ?? null)

  const step = ref(0)
  const policy = ref<ConflictPolicy>('overwrite')
  const applyToAll = ref(true)
  const decisions = ref<Record<string, ConflictPolicy>>({})

  const conflictTotal = computed(() => request.value?.conflicts.length ?? 0)
  const current = computed(() => request.value?.conflicts[step.value] ?? null)
  // 只有服务端任务才提供逐项询问。上传可能一次涉及上万个文件，
  // 逐项询问没有意义，因此始终一次性决策（不显示「应用于全部」勾选框）。
  const multiple = computed(() => request.value?.source === 'task' && conflictTotal.value > 1)
  const stepping = computed(() => multiple.value && !applyToAll.value)
  const destLabel = computed(() => request.value?.destPath ?? '')
  const actionLabel = computed(() => {
    if (request.value?.action) {
      return request.value.action
    }
    return request.value?.isMove ? 'Move' : 'Copy'
  })

  const conflictSummary = computed(() => {
    const req = request.value
    if (!req) {
      return ''
    }
    if (req.totalCount > req.conflicts.length) {
      return `${req.totalCount} conflicts`
    }
    return req.totalCount === 1 ? '1 conflict' : `${req.totalCount} conflicts`
  })

  const currentKind = computed(() => {
    const item = current.value
    if (!item) {
      return 'file-vs-file'
    }
    return item.kind
  })

  const replaceLabel = computed(() => {
    if (currentKind.value === 'file-vs-file') {
      return 'Replace the file in the destination'
    }
    return 'Replace the item in the destination'
  })

  const skipLabel = computed(() => {
    if (currentKind.value === 'file-vs-file') {
      return 'Skip this file'
    }
    return 'Skip this item'
  })

  const keepBothLabel = computed(() => {
    if (currentKind.value === 'file-vs-file') {
      return 'Keep both files (rename the incoming one)'
    }
    return 'Keep both items (rename the incoming one)'
  })

  // 切换到下一个冲突任务时重置交互状态
  watch(request, () => {
    step.value = 0
    policy.value = 'overwrite'
    applyToAll.value = true
    decisions.value = {}
  })

  function submit() {
    const req = request.value
    if (!req) {
      return
    }
    if (!stepping.value) {
      resolveConflict(req.id, { policy: policy.value, applyToAll: true, items: [] })
      return
    }

    const item = req.conflicts[step.value]
    if (item) {
      decisions.value = { ...decisions.value, [item.relativePath]: policy.value }
    }
    if (step.value < req.conflicts.length - 1) {
      step.value += 1
      return
    }
    resolveConflict(req.id, {
      policy: policy.value,
      applyToAll: false,
      items: Object.entries(decisions.value).map(([relativePath, itemPolicy]) => ({
        relativePath,
        policy: itemPolicy,
      })),
    })
  }

  /**
   * 关闭弹窗。
   * 服务端任务继续停在 awaiting-conflict，可从任务面板重新打开；
   * 本地请求（上传）没有重来的机会，关闭等于放弃这次操作。
   */
  function close() {
    const req = request.value
    if (req?.source === 'local') {
      resolveConflict(req.id, null)
      return
    }
    conflictDialogVisible.value = false
  }

  return {
    visible: conflictDialogVisible,
    request,
    current,
    step,
    conflictTotal,
    multiple,
    stepping,
    policy,
    applyToAll,
    decisions,
    destLabel,
    actionLabel,
    conflictSummary,
    currentKind,
    replaceLabel,
    skipLabel,
    keepBothLabel,
    submit,
    close,
  }
}
