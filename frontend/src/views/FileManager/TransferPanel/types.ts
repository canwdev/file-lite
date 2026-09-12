import type { UploadConflictPolicy } from '@/api/filesystem'

/** 一次传输（上传 / 下载）的输入。 */
export interface IBatchFile {
  file?: File
  /** 绝对路径 */
  path: string
  filename?: string
  /** 已知的文件大小（下载来自目录列表，上传来自 File.size） */
  size?: number
  /** 下载时使用的父级目录句柄 */
  parentHandle?: FileSystemDirectoryHandle
  type?: 'upload' | 'download'
  /** 上传同名冲突策略，由 use-transfer 在预检弹窗后决定 */
  onConflict?: UploadConflictPolicy
}

/** 传输窗口里的一行。 */
export interface ITransferItem extends IBatchFile {
  // 任务的序号
  index: number
  // 进度(0-1)
  progress: number
  // 状态
  status: 'success' | 'failed' | 'pending' | 'transferring'
  // 错误信息
  message: string
  // 过程中的abort对象
  abortObj?: { abort: () => void }
  // 成功后返回的结果
  result?: any
  speedInfo?: {
    loaded: number
    total: number
    rate: number
    bytes: number
  }
}

/** 面板的两个页签：上传/下载（客户端传输）与后台文件操作（服务端任务）。 */
export type TransferTab = 'transfers' | 'tasks'

/** 一个页签上的计数，用来做角标。 */
export interface TransferTabCounts {
  total: number
  active: number
  failed: number
}
