import type { Ref } from 'vue'
import type { IEntry } from '@/types/server'
import dayjs from 'dayjs'
import { fsWebApi } from '@/api/filesystem'
import { readSystemClipboard } from '@/utils/clipboard'
import { generateTextFile, normalizePath } from '../../utils'

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
  emit,
}: {
  basePath: Ref<string>
  entries: Ref<IEntry[]>
  isLoading: Ref<boolean>
  emit: (event: 'refresh' | 'patch', ...args: any[]) => void
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
      const path = normalizePath(`${basePath.value}/${filename}`)

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
      await fsWebApi.uploadFile({ path, file })

      window.$message.success(`Pasted ${filename}`)
      const mtime = file.lastModified || Date.now()
      emit('patch', {
        added: [{
          name: filename,
          ext: content.ext,
          isDirectory: false,
          hidden: filename.startsWith('.'),
          lastModified: mtime,
          birthtime: mtime,
          size: file.size,
          error: null,
        }],
      })
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
