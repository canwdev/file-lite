import type { SdkFileApi } from './broker'
import type {
  FileLiteSdk,
  SdkBinary,
  SdkEntry,
  SdkHostContext,
  SdkLaunch,
  SdkOpenEvent,
  SdkPickOptions,
  SdkPickResult,
  SdkStreamOptions,
  SdkTextFile,
  SdkWriteOptions,
  SdkWriteResult,
} from './contract'
import { createSdkBroker } from './broker'
import { SDK_VERSION } from './contract'

/** Injection key for the per-window SDK instance. */
export const FILE_LITE_SDK_KEY = Symbol('fileLiteSdk')

export interface AppSdkTransport {
  sdk: FileLiteSdk
  /** Re-deliver the launch push to every registered `onOpen` callback. */
  emitOpen: (open: SdkOpenEvent | undefined) => void
}

/**
 * The in-process transport for built-in apps. It uses the same broker as the
 * iframe transport, so a capability is implemented once for both.
 */
export function createAppSdk(host: SdkHostContext, files: SdkFileApi): AppSdkTransport {
  const broker = createSdkBroker(host, files)
  const openHandlers: ((open: SdkOpenEvent | undefined) => void)[] = []
  /**
   * The last push, kept so a late subscriber still gets it.
   *
   * Apps are `defineAsyncComponent`, so the first time one is opened its module
   * is still loading when this provider mounts and pushes: the component
   * registers `onOpen` only after the chunk arrives. Replaying here is what
   * makes the first open behave like every later one.
   */
  let lastOpen: { value: SdkOpenEvent | undefined } | null = null

  async function call<T>(method: string, payload: Parameters<typeof broker.invoke>[1]): Promise<T> {
    return await broker.invoke(method, payload) as T
  }

  const sdk: FileLiteSdk = {
    version: SDK_VERSION,

    list: path => call<SdkEntry[]>('list', { path }),
    readFile: path => call<ArrayBuffer>('readFile', { path }),
    readText: path => call<SdkTextFile>('readText', { path }),
    writeFile: (path: string, data: SdkBinary, options?: SdkWriteOptions) =>
      call<SdkWriteResult>('writeFile', { path, data, options }),
    url: path => files.url(path),
    // Client side on purpose: a `ReadableStream` cannot be posted to a page, so
    // both transports fetch the stream URL themselves (same origin, Range works).
    stream: async (path: string, options?: SdkStreamOptions) =>
      await fetch(files.url(path), { credentials: 'same-origin', signal: options?.signal }),

    getLaunch: () => call<SdkLaunch | null>('getLaunch', {}),
    onOpen: (callback) => {
      openHandlers.push(callback)
      const pending = lastOpen
      if (!pending) {
        return
      }
      // Replay outside the render phase: the handler usually calls
      // `setTitle`, which mutates the window an ancestor is rendering.
      queueMicrotask(() => {
        if (lastOpen === pending) {
          callback(pending.value)
        }
      })
    },
    updateLaunch: launch => call<void>('updateLaunch', { launch }),
    setTitle: title => call<void>('setTitle', { title }),
    exit: () => call<void>('exit', {}),
    selectItems: names => call<void>('selectItems', { names }),
    revealItem: name => call<void>('revealItem', { name }),
    pick: (options?: SdkPickOptions) => call<SdkPickResult | null>('pick', { pick: options }),
  }

  return {
    sdk,
    emitOpen: (open) => {
      lastOpen = { value: open }
      for (const callback of openHandlers) {
        callback(open)
      }
    },
  }
}

/**
 * The SDK of the app window the caller lives in. Only works inside an app
 * component rendered by `AppSdkProvider`; plugin pages call
 * `window.fileLiteSDK` instead.
 */
export function useFileLiteSdk(): FileLiteSdk {
  const sdk = inject<FileLiteSdk | null>(FILE_LITE_SDK_KEY, null)
  if (!sdk) {
    throw new Error('FileLite SDK is only available inside an app window')
  }
  return sdk
}
