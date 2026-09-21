<script lang="ts" setup>
import type { AppParams } from '@/views/Apps/apps.ts'
import { fs } from '@/utils/fs'

const props = defineProps<{
  appParams: AppParams
}>()
const emit = defineEmits(['setTitle', 'exit'])

/**
 * jspaint 暴露给宿主页面的接口（`public/jspaint/src/app.js` 的 `window.systemHooks`
 * 与几个全局函数）。这里只声明用到的部分。
 */
type JsPaintWindow = Window & {
  file_new: () => void
  open_from_file: (file: File, sourceFileHandle?: string | null) => void
  save_as_prompt: (props: {
    dialogTitle?: string
    defaultFileName?: string
    defaultFileFormatID?: string
    formats: unknown[]
    promptForName?: boolean
  }) => Promise<{ newFileName: string, newFileFormatID: string }>
  systemHooks: {
    showOpenFileDialog: (props: { formats: unknown[] }) => Promise<{ file?: File }>
    showSaveFileDialog: (props: {
      dialogTitle?: string
      defaultFileName?: string
      defaultFileFormatID?: string
      formats: unknown[]
      getBlob: (formatId: string) => Promise<Blob>
      savedCallbackUnreliable?: (info: {
        newFileName: string
        newFileFormatID: string
        newFileHandle: unknown
        newBlob: Blob
      }) => void
    }) => Promise<void>
    writeBlobToHandle: (fileHandle: unknown, blob: Blob) => Promise<unknown> | unknown
  }
}

/**
 * 随应用一起分发的 JS Paint（`public/jspaint/`，取自 daedalOS 的同名副本）。
 *
 * 与应用同源，静态资源也跟着应用挂载点走，所以地址由 BASE_URL 拼出来，而不是写死
 * `/jspaint/`。同源让宿主能像 daedalOS 那样接管它的文件读写：
 *
 * - 打开：把文件读成 `File` 交给 `open_from_file`，并把虚拟路径当作它的 file handle；
 * - 保存（Ctrl+S）：handle 是路径就写回原文件；
 * - 另存为：弹出格式对话框后走浏览器下载，不写回文件管理器。
 */
const JS_PAINT_URL = `${import.meta.env.BASE_URL}jspaint/index.html`

const iframeRef = ref<HTMLIFrameElement>()
const isLoading = ref(true)
const paintWindow = ref<JsPaintWindow | null>(null)
/** 已经注入画布的那个路径，用来区分「换了文件」和「又点了一次同一个文件」。 */
let openedPath = ''
let loadController: AbortController | null = null

/** 某个路径的父目录（与 TextEditor 的 dirOf 同规则）。 */
function dirOf(path: string) {
  const cut = path.replace(/\/+$/, '').lastIndexOf('/')
  return cut > 0 ? path.slice(0, cut) : path
}

/** 某个路径的文件名。 */
function baseOf(path: string) {
  return path.slice(path.lastIndexOf('/') + 1)
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.append(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
}

function installFileHooks(win: JsPaintWindow) {
  const defaultWriteBlobToHandle = win.systemHooks.writeBlobToHandle

  // Ctrl+S / File > Save：文档来自文件管理器时，handle 就是我们传进去的路径，原路写回。
  // 其它来源（jspaint 自己 Open 的本机文件、新建画布）没有路径，交回 jspaint 默认行为（下载）。
  win.systemHooks.writeBlobToHandle = async (fileHandle, blob) => {
    if (typeof fileHandle !== 'string' || !fileHandle) {
      return defaultWriteBlobToHandle(fileHandle, blob)
    }

    const written = await fs.writeFile(dirOf(fileHandle), baseOf(fileHandle), blob, {
      // 保存就是覆盖打开的那个文件
      conflict: 'overwrite',
    })
    if (!written.ok) {
      window.$message?.warning(written.reason ?? 'This location is read-only')
      return false
    }

    return true
  }

  // File > Save As / Ctrl+Shift+S：选格式和文件名后，用宿主页触发浏览器下载。
  // 不写回打开的那条路径，也不把下载结果当成新的 file handle，Ctrl+S 仍覆盖原文件。
  win.systemHooks.showSaveFileDialog = async (dialogProps) => {
    const { newFileName, newFileFormatID } = await win.save_as_prompt({
      dialogTitle: dialogProps.dialogTitle,
      defaultFileName: dialogProps.defaultFileName,
      defaultFileFormatID: dialogProps.defaultFileFormatID,
      formats: dialogProps.formats,
    })
    const blob = await dialogProps.getBlob(newFileFormatID)
    downloadBlob(blob, newFileName)
    dialogProps.savedCallbackUnreliable?.({
      newFileName,
      newFileFormatID,
      newFileHandle: openedPath || null,
      newBlob: blob,
    })
  }

  // File > Open 是 jspaint 自己弹的系统选择框，打开的文档没有路径，标题跟着文件名走；
  // 之后的 Ctrl+S 没有 handle，会走 Save As 下载（不会误写别的文件）。
  const defaultShowOpenFileDialog = win.systemHooks.showOpenFileDialog
  win.systemHooks.showOpenFileDialog = async (dialogProps) => {
    const result = await defaultShowOpenFileDialog(dialogProps)
    if (result?.file) {
      openedPath = ''
      emit('setTitle', result.file.name)
    }
    return result
  }

  // File > New：画布清空，标题退回应用名
  const defaultFileNew = win.file_new
  win.file_new = () => {
    defaultFileNew()
    openedPath = ''
    emit('setTitle', '')
  }

  // File > Exit：jspaint 调 window.close()；这里接到宿主，关掉画图窗口。
  win.close = () => {
    emit('exit')
  }
}

async function openFile(win: JsPaintWindow, absPath: string, name: string) {
  loadController?.abort()
  const controller = new AbortController()
  loadController = controller

  try {
    const blob = await fs.readBlob(absPath, { signal: controller.signal })
    if (controller.signal.aborted) {
      return
    }
    // 路径同时作为 file handle 传进去，Ctrl+S 才有地方可写
    win.open_from_file(new File([blob], name, { type: blob.type }), absPath)
    openedPath = absPath
    emit('setTitle', name)
  }
  catch (error) {
    if (!controller.signal.aborted) {
      console.error('[JsPaint] open file failed', error)
    }
  }
}

function openCurrentFile() {
  const win = paintWindow.value
  const absPath = props.appParams?.absPath
  if (!win || !absPath || absPath === openedPath) {
    return
  }
  void openFile(win, absPath, props.appParams.item.name)
}

function handleLoad() {
  isLoading.value = false

  const win = iframeRef.value?.contentWindow as JsPaintWindow | null
  if (!win) {
    return
  }

  paintWindow.value = win
  installFileHooks(win)
  // 刚加载出来的 jspaint 是空白的，注入了什么才算打开过什么
  openedPath = ''
  openCurrentFile()
}

// 单例窗口被复用时（再点一次「Open With -> JS Paint」）iframe 不重载，这里负责换文件
watch(() => props.appParams, openCurrentFile)

onBeforeUnmount(() => {
  loadController?.abort()
})
</script>

<template>
  <div class="js-paint">
    <iframe
      ref="iframeRef"
      class="js-paint__frame"
      :src="JS_PAINT_URL"
      title="JS Paint"
      allow="clipboard-read; clipboard-write"
      @load="handleLoad"
    />
    <!-- 本地站点首帧之前先把这块盖住，避免画布空白闪一下 -->
    <div v-if="isLoading" class="js-paint__status vgo-u-surface">
      Loading JS Paint...
    </div>
  </div>
</template>

<style lang="scss" scoped>
.js-paint {
  position: relative;
  width: 100%;
  height: 100%;

  &__frame {
    display: block;
    width: 100%;
    height: 100%;
    border: 0;
  }

  &__status {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--vgo-text-secondary);
  }
}
</style>
