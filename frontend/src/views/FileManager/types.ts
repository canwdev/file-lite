import type { IEntry } from '@/types/server'

/**
 * 文件(夹)选择器的选中结果。
 *
 * `folder` 模式选中当前目录本身时没有条目，只有 `basePath`；`save` 模式没有条目，
 * 返回当前目录 `basePath` 与用户输入的文件名 `name`。
 */
export interface FileSelectResult {
  items?: IEntry[]
  item?: IEntry
  basePath: string
  /** `save` 模式：用户输入的文件名（不含目录） */
  name?: string
}
