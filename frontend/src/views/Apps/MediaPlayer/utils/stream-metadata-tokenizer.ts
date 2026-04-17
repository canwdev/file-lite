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
  ) {
    this.config = { ...DEFAULT_HTTP, ...config }
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
): Promise<IRandomAccessTokenizer> {
  const client = new CookieRangeHttpClient(streamUrl, httpClientConfig)
  return tokenizer(client, tokenizerConfig)
}
