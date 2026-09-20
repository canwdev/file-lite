import type { HttpClientConfig } from '@tokenizer/http'
import type {
  IHeadRequestInfo,
  IRangeRequestClient,
  IRangeRequestConfig,
  IRangeRequestResponse,
} from '@tokenizer/range'
import type { IRandomAccessTokenizer } from 'strtok3'
import { parseContentRange, tokenizer } from '@tokenizer/range'

const DEFAULT_HTTP: HttpClientConfig = {
  resolveUrl: false,
}

function acceptRangesBytes(res: Response): boolean {
  const v = res.headers.get('Accept-Ranges')
  return v !== null && v.trim().toLowerCase() === 'bytes'
}

function headResponseToInfo(res: Response): IHeadRequestInfo {
  if (!res.ok) {
    throw new TypeError(`HEAD request failed: ${res.status}`)
  }
  const len = res.headers.get('Content-Length')
  const size = len ? Number.parseInt(len, 10) : Number.NaN
  if (!Number.isFinite(size)) {
    throw new TypeError('HEAD response missing usable Content-Length')
  }
  return {
    size,
    mimeType: res.headers.get('Content-Type') ?? undefined,
    acceptPartialRequests: acceptRangesBytes(res),
    url: res.url,
  }
}

function rangeResponseToInfo(res: Response): IRangeRequestResponse {
  if (!res.ok) {
    throw new TypeError(`Unexpected HTTP response status=${res.status}`)
  }
  const contentRangeHeader = res.headers.get('Content-Range')
  const contentRange = contentRangeHeader
    ? parseContentRange(contentRangeHeader)
    : undefined
  const len = res.headers.get('Content-Length')
  const sizeFromLen = len ? Number.parseInt(len, 10) : undefined
  const size = contentRange?.instanceLength ?? sizeFromLen
  if (typeof size !== 'number' || Number.isNaN(size)) {
    throw new TypeError('Could not determine file-size from HTTP response')
  }
  return {
    url: res.url,
    size,
    mimeType: res.headers.get('Content-Type') ?? undefined,
    acceptPartialRequests: acceptRangesBytes(res),
    contentRange,
    arrayBuffer: () => res.arrayBuffer().then(b => new Uint8Array(b)),
  }
}

/**
 * `blob:` 地址的 range 客户端。
 *
 * **`fetch(blobUrl, { method: 'HEAD' })` 会直接失败**（Chromium 报
 * `net::ERR_METHOD_NOT_SUPPORTED`），而 range tokenizer 的第一步就是 HEAD。
 * blob 本来就在内存里，元数据（大小 / MIME）直接问 Blob 对象即可，Range 用
 * `slice` 取，一次网络请求都不需要。
 */
class BlobRangeClient implements IRangeRequestClient {
  private size = 0
  private mimeType?: string

  constructor(private readonly url: string) {}

  private async blob(): Promise<Blob> {
    const res = await fetch(this.url)
    if (!res.ok) {
      throw new TypeError(`Failed to read blob url: ${res.status}`)
    }
    return await res.blob()
  }

  async getHeadInfo(): Promise<IHeadRequestInfo> {
    const blob = await this.blob()
    this.size = blob.size
    this.mimeType = blob.type || undefined
    return {
      size: this.size,
      mimeType: this.mimeType,
      // 本地对象支持任意切片
      acceptPartialRequests: true,
      url: this.url,
    }
  }

  async getResponse(method: string, range?: [number, number]): Promise<IRangeRequestResponse> {
    const blob = await this.blob()
    this.size = blob.size
    const sliced = range ? blob.slice(range[0], range[1] + 1) : blob
    const contentRange = range
      ? { start: range[0], end: range[1], instanceLength: this.size }
      : undefined
    return {
      url: this.url,
      size: this.size,
      mimeType: this.mimeType,
      acceptPartialRequests: true,
      contentRange,
      arrayBuffer: () => sliced.arrayBuffer().then(b => new Uint8Array(b)),
    }
  }

  abort() {
    // blob 读取没有在途请求可中断
  }
}

/**
 * Same idea as `@tokenizer/http` HttpClient, but sends cookies (`credentials: 'include'`)
 * for session auth while using Range requests.
 */
class CookieRangeHttpClient implements IRangeRequestClient {
  private readonly abortController = new AbortController()
  private readonly config: HttpClientConfig
  resolvedUrl?: string

  constructor(
    private readonly url: string,
    config?: HttpClientConfig,
    signal?: AbortSignal,
  ) {
    this.config = { ...DEFAULT_HTTP, ...config }
    // 外部取消（网格里滚动出视野）时一并中断在途的 HEAD / Range 请求
    if (signal) {
      if (signal.aborted) {
        this.abortController.abort()
      }
      else {
        signal.addEventListener('abort', () => this.abortController.abort(), { once: true })
      }
    }
  }

  async getHeadInfo(): Promise<IHeadRequestInfo> {
    const res = await fetch(this.url, {
      method: 'HEAD',
      signal: this.abortController.signal,
      credentials: 'include',
    })
    if (this.config.resolveUrl) {
      this.resolvedUrl = res.url
    }
    return headResponseToInfo(res)
  }

  async getResponse(method: string, range?: [number, number]): Promise<IRangeRequestResponse> {
    const headers = new Headers()
    if (range) {
      headers.set('Range', `bytes=${range[0]}-${range[1]}`)
    }
    const res = await fetch(this.resolvedUrl || this.url, {
      method,
      headers,
      signal: this.abortController.signal,
      credentials: 'include',
    })
    const info = rangeResponseToInfo(res)
    if (this.config.resolveUrl) {
      this.resolvedUrl = res.url
    }
    return info
  }

  abort() {
    this.abortController.abort()
  }
}

export async function makeStreamMetadataTokenizer(
  streamUrl: string,
  tokenizerConfig?: IRangeRequestConfig,
  httpClientConfig?: HttpClientConfig,
  signal?: AbortSignal,
): Promise<IRandomAccessTokenizer> {
  // blob 地址不支持 HEAD，走本地切片；HTTP 地址才需要 Range + cookie
  const client = streamUrl.startsWith('blob:')
    ? new BlobRangeClient(streamUrl)
    : new CookieRangeHttpClient(streamUrl, httpClientConfig, signal)
  return tokenizer(client, tokenizerConfig)
}
