import type { Ref } from 'vue'
import type { IEntry } from '@/types/server'
import dayjs from 'dayjs'
import { readSystemClipboard } from '@/utils/clipboard'
import { fs } from '@/utils/fs'
import { generateTextFile, joinPath, normalizePath } from '../../utils'

function appendCopySuffix(name: string, index?: number) {
  const suffix = index ? `-copy-${index}` : '-copy'
  const dotIndex = name.lastIndexOf('.')
  if (dotIndex > 0)
    return `${name.slice(0, dotIndex)}${suffix}${name.slice(dotIndex)}`
  return `${name}${suffix}`
}

function buildUniqueName(ext: string, existingNames: Set<string>) {
  const base = `${dayjs().format('YYYYMMDD_HHmmss')}${ext}`
  if (!existingNames.has(base))
    return base

  for (let i = 2; i < 1000; i++) {
    const candidate = appendCopySuffix(base, i)
    if (!existingNames.has(candidate))
      return candidate
  }
  return `${base.slice(0, -ext.length)}-${Date.now()}${ext}`
}

export function useSystemClipboardPaste({
  basePath,
  entries,
  isLoading,
}: {
  basePath: Ref<string>
  entries: Ref<IEntry[]>
  isLoading: Ref<boolean>
}) {
  const handlePasteFromClipboard = async () => {
    try {
      const content = await readSystemClipboard()
      if (!content) {
        window.$message.warning('No supported content in clipboard')
        return
      }

      const existingNames = new Set(entries.value.map(entry => entry.name))
      const filename = buildUniqueName(content.ext, existingNames)
      const path = normalizePath(joinPath(basePath.value, filename))
      const name = path.split('/').pop() ?? filename

      // 从门面问一次能不能写，不能写就当场说明原因
      const guard = await fs.canWrite(path)
      if (!guard.ok) {
        window.$message.warning(guard.reason ?? 'This location is read-only')
        return
      }

      isLoading.value = true

      let file: File
      if (content.kind === 'image') {
        file = new File([content.blob], filename, { type: content.mime })
      }
      else if (content.kind === 'html') {
        file = new File([content.text], filename, { type: 'text/html;charset=utf-8' })
      }
      else {
        file = generateTextFile(content.text, filename)
      }

      // 走门面写文件
      const written = await fs.writeFile(basePath.value, name, file)
      if (!written.ok) {
        window.$message.warning(written.reason ?? 'This location is read-only')
        return
      }

      window.$message.success(`Pasted ${filename}`)
    }
    catch (error) {
      console.error('[pasteFromClipboard]', error)
      window.$message.error(`Failed to paste from clipboard: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
    finally {
      isLoading.value = false
    }
  }

  return {
    handlePasteFromClipboard,
  }
}
