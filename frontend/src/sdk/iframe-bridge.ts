import type { SdkInvokePayload } from './broker'
import type { SdkOpenEvent, SdkOpenMessage, SdkResponse } from './contract'
import { SDK_SOURCE_HOST, SDK_SOURCE_PLUGIN } from './contract'

/** A host message without its source tag; `post` adds the tag. */
type HostMessageBody = Omit<SdkResponse, 'source'> | Omit<SdkOpenMessage, 'source'>

export interface IframeBridgeOptions {
  /** The iframe's content window; `null` while the element is not mounted. */
  getWindow: () => Window | null
  invoke: (method: string, payload: SdkInvokePayload) => Promise<unknown>
  /** Called when a request failed, before the reply is sent. */
  onError?: (method: string, message: string) => void
}

export interface IframeBridge {
  handleMessage: (event: MessageEvent) => void
  pushOpen: (open: SdkOpenEvent | undefined) => void
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * The host half of the plugin transport: filters messages, correlates replies
 * by request id and hands every method to the shared broker.
 */
export function createIframeBridge(options: IframeBridgeOptions): IframeBridge {
  function post(message: HostMessageBody, transfer: Transferable[] = []) {
    options.getWindow()?.postMessage({ source: SDK_SOURCE_HOST, ...message }, globalThis.location.origin, transfer)
  }

  function reply(id: number, error?: string, data?: unknown) {
    // Hand the buffer over instead of copying it. Plugins can read large files
    // (game archives), and structured cloning would double the peak memory.
    const transfer = data instanceof ArrayBuffer ? [data] : []
    post({ id, error, data }, transfer)
  }

  function handleMessage(event: MessageEvent) {
    if (event.origin !== globalThis.location.origin) {
      return
    }
    if (event.source !== options.getWindow()) {
      return
    }
    const data = event.data
    if (!data || data.source !== SDK_SOURCE_PLUGIN || typeof data.id !== 'number') {
      return
    }

    void options.invoke(String(data.method ?? ''), data).then(
      (result) => {
        reply(data.id, undefined, result)
      },
      (error) => {
        const message = errorMessage(error)
        options.onError?.(String(data.method ?? ''), message)
        reply(data.id, message)
      },
    )
  }

  function pushOpen(open: SdkOpenEvent | undefined) {
    if (!open) {
      post({ event: 'open' })
      return
    }
    post({
      event: 'open',
      path: open.path,
      filename: open.filename,
      directory: open.directory,
    })
  }

  return { handleMessage, pushOpen }
}
