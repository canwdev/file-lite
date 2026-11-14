/**
 * 应用内拖拽（把选中的文件 / 文件夹拖到某个目录）的共享协议与判定。
 *
 * 四类落点——列表里的文件夹行、面包屑、收藏夹、磁盘根——都只调用这里的两个原语：
 * `acceptDirDrag`（dragover 判定 + 光标）与 `dropIntoDir`（执行）。
 * 落点是「目录路径」，所以内部拖拽（移动/复制任务）与系统拖入（上传到该目录）
 * 可以走同一条路径，行为一致。
 *
 * 协议细节：
 * - 自定义 MIME 里只放「源目录 + 名字」，不放服务器绝对路径，避免被外部应用读到；
 * - `dragover` 阶段浏览器不允许读 `getData`，所以「是不是内部拖拽」只看
 *   `dataTransfer.types`，路径信息用模块级会话补上（同窗口内有效）。
 */
import type { InjectionKey, Ref } from 'vue'
import { inject, ref, shallowRef } from 'vue'
import { createTask, onTaskDone } from '@/store/tasks'
import { getParentPath, normalizeListingPath } from '../utils'
import { loadDrives, resolveVolumeRoot } from './drives'
import { reconcileClipboardAfterMove } from './hooks/use-copy-paste'

export const ENTRY_DRAG_MIME = 'application/x-file-lite-entries'

export interface EntryDragItem {
  name: string
  isDirectory: boolean
}

export interface EntryDragPayload {
  v: 1
  sourceBasePath: string
  items: EntryDragItem[]
}

export interface EntryDragSession {
  /** 拖拽来源目录（listing 形态） */
  sourceBasePath: string
  /** 被拖走的条目绝对路径，与 items 一一对应 */
  paths: string[]
  items: EntryDragItem[]
}

/** 选择器模式（FileSelector）下由 FileManager 提供 false，禁用全部拖拽。 */
export const dragEnabledKey: InjectionKey<Ref<boolean>> = Symbol('fileLiteExplorerDragEnabled')

export function useDragEnabled(): Ref<boolean> {
  return inject(dragEnabledKey, ref(true)) as Ref<boolean>
}

/** 当前窗口内正在进行的内部拖拽；`dragover` 读不到 DataTransfer 内容时靠它。 */
export const dragSession = shallowRef<EntryDragSession | null>(null)

export function isInternalDrag(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes(ENTRY_DRAG_MIME)
}

/**
 * 收藏夹内部的排序拖拽（拖的是收藏项，不是文件）。
 * 用单独的 MIME 区分：收藏项同时也是「文件落点」，两者必须走不同的分支。
 */
export const STAR_DRAG_MIME = 'application/x-file-lite-star'

export function isStarDrag(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes(STAR_DRAG_MIME)
}

export function isExternalFileDrag(event: DragEvent): boolean {
  const dataTransfer = event.dataTransfer
  if (!dataTransfer) {
    return false
  }
  if (dataTransfer.files && dataTransfer.files.length > 0) {
    return true
  }
  return Array.from(dataTransfer.types ?? []).includes('Files')
}

export function beginEntryDrag(event: DragEvent, session: EntryDragSession): void {
  dragSession.value = session
  const payload: EntryDragPayload = {
    v: 1,
    sourceBasePath: session.sourceBasePath,
    items: session.items,
  }
  event.dataTransfer?.setData(ENTRY_DRAG_MIME, JSON.stringify(payload))
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'copyMove'
  }
  // 预取卷信息，dragover 阶段才能同步给出「移动 / 复制」的光标
  void loadDrives()
}

export function endEntryDrag(): void {
  dragSession.value = null
}

/**
 * 该目录能不能作为这次内部拖拽的落点。
 *
 * 与资源管理器一致：不能放进自己或自己的子孙（后端也会拒绝，这里提前给出反馈），
 * 已在目标目录里的项不算有效落点（原地移动没有意义）。
 *
 * 例外：按住 Ctrl（复制）拖回源目录时，资源管理器的语义是「原地复制」，
 * 也就是 duplicate —— 由 `allowSameDir` 放行，最终生成 `name - Copy`。
 */
export function canDropEntries(destDir: string, session: EntryDragSession, options: { allowSameDir?: boolean } = {}): boolean {
  const target = normalizeListingPath(destDir)
  // Identity is the item's real parent, not sourceBasePath: a branch listing
  // flattens several folders, so "dragging back to the listed folder" is only
  // a no-op when every item already lives directly in the target.
  const inTarget = (path: string) => normalizeListingPath(getParentPath(path)) === target
  const allInTarget = session.paths.length > 0 && session.paths.every(inTarget)
  if (allInTarget) {
    return Boolean(options.allowSameDir)
  }
  return session.items.every((item, index) => {
    if (!item.isDirectory) {
      return true
    }
    const source = normalizeListingPath(session.paths[index] ?? '')
    return !(target === source || target.startsWith(source))
  })
}

/** Ctrl / Cmd / Alt 强制复制；Shift 强制移动（资源管理器语义）。 */
export function isCopyModifier(event: DragEvent): boolean {
  return event.ctrlKey || event.metaKey || event.altKey
}

function volumeMode(destDir: string, session: EntryDragSession): 'move' | 'copy' {
  const targetVolume = resolveVolumeRoot(destDir)
  // 卷未知（驱动器还没加载出来）时按同卷处理：默认移动
  if (!targetVolume) {
    return 'move'
  }
  // 平铺列表可能跨挂载点；按每个源自己的卷判断，任一不同就按复制处理
  const crossesVolume = session.paths.some((path) => {
    const sourceVolume = resolveVolumeRoot(path)
    return sourceVolume !== null && sourceVolume !== targetVolume
  })
  return crossesVolume ? 'copy' : 'move'
}

/** dragover 阶段的光标提示，必须同步，所以只用已缓存的卷信息。 */
function dropModeHint(destDir: string, session: EntryDragSession, event: DragEvent): 'move' | 'copy' {
  if (isCopyModifier(event)) {
    return 'copy'
  }
  if (event.shiftKey) {
    return 'move'
  }
  return volumeMode(destDir, session)
}

/** drop 阶段的实际决策：此处可以等驱动器列表加载完，跨卷判定更准。 */
async function resolveDropMode(destDir: string, session: EntryDragSession, event: DragEvent): Promise<'move' | 'copy'> {
  if (isCopyModifier(event)) {
    return 'copy'
  }
  if (event.shiftKey) {
    return 'move'
  }
  await loadDrives()
  return volumeMode(destDir, session)
}

async function performEntryDrop(destDir: string, event: DragEvent, session: EntryDragSession): Promise<void> {
  const target = normalizeListingPath(destDir)
  // Only treat the drop as "back into the source folder" when every item already
  // sits there. In a branch listing the listed root can be the target while the
  // dragged files live deeper, and those should still move / copy to the root.
  const inTarget = (path: string) => normalizeListingPath(getParentPath(path)) === target
  const allInTarget = session.paths.length > 0 && session.paths.every(inTarget)

  if (allInTarget) {
    try {
      await createTask({ kind: 'duplicate', fromPaths: [...session.paths], toPath: target })
    }
    catch (error: any) {
      window.$message?.error(error?.message || $t('file_lite_i18n.failed_to_start_the_task'))
    }
    return
  }

  const kind = (await resolveDropMode(target, session, event)) === 'copy' ? 'copy' : 'move'
  // A move skips items that are already in the target; a copy keeps them so the
  // backend creates a copy beside the original, matching Explorer.
  const fromPaths = kind === 'move'
    ? session.paths.filter(path => !inTarget(path))
    : [...session.paths]
  if (!fromPaths.length) {
    return
  }

  try {
    const taskId = await createTask({ kind, fromPaths, toPath: target, onConflict: 'ask' })
    if (kind === 'move') {
      // 拖走的是剪切板里的项时，剪切 / 复制剪贴板都要摘掉，否则之后粘贴会指向不存在的源
      onTaskDone(taskId, (_task, results, truncated) => reconcileClipboardAfterMove(results, truncated))
    }
  }
  catch (error: any) {
    window.$message?.error(error?.message || $t('file_lite_i18n.failed_to_start_the_task'))
  }
}

/* ------------------------------------------------------------------ *
 * 系统拖入文件 / 文件夹 → 上传到落点目录
 * ------------------------------------------------------------------ */

export type ExternalDropSink = (destDir: string, event: DragEvent) => void | Promise<void>

let externalDropSink: ExternalDropSink | null = null

export function registerExternalDropSink(sink: ExternalDropSink): void {
  externalDropSink = sink
}

async function uploadExternalDrop(destDir: string, event: DragEvent): Promise<void> {
  if (!externalDropSink) {
    window.$message?.warning($t('file_lite_i18n.the_drop_target_is_not_ready'))
    return
  }
  await externalDropSink(normalizeListingPath(destDir), event)
}

/* ------------------------------------------------------------------ *
 * 落点原语
 * ------------------------------------------------------------------ */

export interface DirDropOptions {
  /**
   * 外部文件是否交给外层上传区处理。
   * 列表里的文件夹行交给外层（由外层按行解析目标目录），
   * 面包屑 / 收藏夹 / 磁盘这些没有外层上传区的落点自己处理。
   */
  delegateExternal?: boolean
}

/**
 * dragover / dragenter 判定。返回非 null 表示该目录是本次拖拽的合法落点，
 * 调用方据此高亮。
 *
 * 内部拖拽必须 `stopPropagation`：列表外层还挂着一个上传拖放区，
 * 它会把 `dropEffect` 改回 `none`（不合法类型），光标反馈会失效。
 */
export function acceptDirDrag(destDir: string, event: DragEvent, options: DirDropOptions = {}): 'internal' | 'external' | null {
  if (isInternalDrag(event)) {
    const session = dragSession.value
    // Ctrl 拖回源目录 = 原地复制（duplicate），其它修饰键组合沿用移动 / 复制语义
    if (!session || !canDropEntries(destDir, session, { allowSameDir: isCopyModifier(event) })) {
      return null
    }
    event.preventDefault()
    event.stopPropagation()
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = dropModeHint(destDir, session, event)
    }
    return 'internal'
  }

  if (isExternalFileDrag(event)) {
    if (options.delegateExternal) {
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'copy'
      }
      return 'external'
    }
    event.preventDefault()
    event.stopPropagation()
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy'
    }
    return 'external'
  }

  return null
}

/**
 * 执行放置。
 *
 * @returns true 表示已处理（内部移动 / 复制，或外部上传）；false 表示调用方应把
 *          事件继续交给外层上传区。
 */
export function dropIntoDir(destDir: string, event: DragEvent, options: DirDropOptions = {}): boolean {
  if (isInternalDrag(event)) {
    const session = dragSession.value
    endEntryDrag()
    event.preventDefault()
    event.stopPropagation()
    if (!session || !canDropEntries(destDir, session, { allowSameDir: isCopyModifier(event) })) {
      return false
    }
    void performEntryDrop(destDir, event, session)
    return true
  }

  if (isExternalFileDrag(event)) {
    if (options.delegateExternal) {
      return false
    }
    event.preventDefault()
    event.stopPropagation()
    void uploadExternalDrop(destDir, event)
    return true
  }

  return false
}
