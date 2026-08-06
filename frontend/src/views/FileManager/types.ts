import type { IEntry } from '@/types/server'

/**
 * 文件(夹)选择器的选中结果。
 * `folder` 模式选中当前目录本身时没有条目，只有 `basePath`。
 */
export interface FileSelectResult {
  items?: IEntry[]
  item?: IEntry
  basePath: string
}
