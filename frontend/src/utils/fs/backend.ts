/**
 * 存储后端的统一接口。
 *
 * 前端有两种存储：服务端（`/api/files/*`）与浏览器挂载的本地文件夹（File System
 * Access API）。调用方**不应该**自己判断该走哪一个——那种判断散布在 app 里正是
 * 「写挂载卷时漏掉只读守卫」这类问题的来源。所有调用点只面向 `fs`（`./index`），
 * 由它按路径分派到实现本接口的后端。
 *
 * 接口只描述**字节与元数据**，不含任务、进度、冲突弹窗这些编排概念：
 * 那些属于上层（`client-tasks` / `server tasks`），塞进来只会让两个执行器互相迁就。
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
   * 由**后端自己**回答：服务端没有只读态，挂载卷要查授权状态（那是挂载表的领域）。
   * 门面只负责把路径转给正确的后端。
   */
  canWrite: (path: string) => Promise<{ ok: boolean, reason?: string }>

  /** 列目录（含隐藏项与否由调用方决定）。 */
  list: (path: string, options?: { showHidden?: boolean }) => Promise<IEntry[]>

  /** 读取文件内容的访问地址（服务端给 HTTP URL，挂载卷给 objectURL）。 */
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
   * （服务端要发请求，挂载卷查句柄），共享一份逻辑反而要再分派一次。
   */
  uniqueName: (dirPath: string, filename: string) => Promise<string>
}

/**
 * 挂载后端的实现由 `ExplorerUI/mounted-volumes.ts` 在模块求值时注入。
 *
 * 用注入而不是直接 import，是为了让本目录（`utils/fs/`）保持**没有 vue / idb /
 * DOM 依赖**：这样它既能被 app 层引用，也能被单测直接跑，而且不会出现
 * 「工具层反过来依赖视图层」的环。
 */
let browserBackend: FsBackend | null = null

/** 服务端后端是本模块自带的，没有挂载支持时它也始终可用。 */
export function registerBrowserBackend(backend: FsBackend | null) {
  browserBackend = backend
}

/** 当前是否已有挂载后端可用（仅用于能力判断，不用于分流）。 */
export function hasBrowserBackend(): boolean {
  return browserBackend !== null
}

export function getBrowserBackend(): FsBackend {
  if (!browserBackend) {
    throw new Error('the browser-mounted backend is not registered')
  }
  return browserBackend
}
