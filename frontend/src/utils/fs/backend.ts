/**
 * 存储后端的统一接口。
 *
 * 前端目前只有一种存储：服务端（`/api/files/*`）。调用点仍然只面向 `fs`
 * （`./index`），不直接调文件 API：字节与元数据从一个收口处出去，任务、进度、
 * 冲突弹窗这些编排概念留在上层。
 *
 * 接口只描述**字节与元数据**，不含任务、进度、冲突弹窗这些编排概念：
 * 那些属于上层（`server tasks`），塞进来只会让两层互相迁就。
 */
import type { IEntry } from '@/types/server'

/** 同名冲突策略。与服务端 `upload-file` 的 `onConflict` 及上传队列保持一致。 */
export type FsConflictPolicy = 'error' | 'overwrite' | 'keep-both' | 'skip'

export interface FsWriteOptions {
  conflict?: FsConflictPolicy
  signal?: AbortSignal
  /** 已写入的字节数（上传进度用；两个后端都按需上报）。 */
  onProgress?: (loaded: number) => void
}

/** 写入结果：`keep-both` 可能改名，调用方需要知道真正的落点。 */
export interface FsWriteResult {
  ok: boolean
  /** 实际写入的路径（keep-both 改名后与请求路径不同） */
  path?: string
  /** 实际写入的文件名 */
  name?: string
  /** 未执行的原因（只读卷、策略为 skip 等） */
  reason?: string
}

export interface FsBackend {
  /**
   * 该后端能不能写这条路径。
   *
   * 返回 `ok: false` 时 `reason` 是要给用户看的一句话。这是把「只读 / 未授权」的
   * 判断收在一处的地方：过去每个调用点都要自己记得先问一次。
   *
   * 由**后端自己**回答：服务端没有只读态，访问范围由 `allowedRoots` 收口。
   * 门面只负责把路径转给正确的后端。
   */
  canWrite: (path: string) => Promise<{ ok: boolean, reason?: string }>

  /** 列目录（含隐藏项与否由调用方决定）。 */
  list: (path: string, options?: { showHidden?: boolean }) => Promise<IEntry[]>

  /** 读取文件内容的访问地址（HTTP URL）。 */
  url: (path: string) => string

  /** 在 `dirPath` 下写一个文本文件（编辑器保存、新建文件走它）。 */
  writeText: (dirPath: string, name: string, content: string, options?: FsWriteOptions) => Promise<FsWriteResult>

  /** 在 `dirPath` 下写一段二进制内容（剪贴板图片等）。 */
  writeFile: (dirPath: string, name: string, data: BlobPart, options?: FsWriteOptions) => Promise<FsWriteResult>

  /** 创建目录（已存在按成功处理）。 */
  mkdir: (path: string, options?: { recursive?: boolean }) => Promise<void>

  /** 重命名 / 移动（同后端内）。 */
  rename: (fromPath: string, toPath: string) => Promise<void>

  /** 删除（目录递归）。 */
  remove: (path: string) => Promise<void>

  /** 该路径是否已存在。 */
  exists: (path: string) => Promise<boolean>

  /**
   * 在 `dirPath` 下找一个没被占用的 `keep-both` 名字（`file (1).txt`）。
   *
   * 放在后端而不是做成共享工具：两种存储的「占用」判断本身就是后端细节
   * （它要发请求问服务端），抽成共享工具反而多一层。
   */
  uniqueName: (dirPath: string, filename: string) => Promise<string>
}
