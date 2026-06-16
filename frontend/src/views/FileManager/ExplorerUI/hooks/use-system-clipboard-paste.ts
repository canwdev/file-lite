import type { Ref } from 'vue'
import type { IEntry } from '@/types/server'
import moment from 'moment/moment'
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
  const base = `${moment(new Date()).format('YYYYMMDD_HHmmss')}${ext}`
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
  emit: (event: 'refresh', ...args: any[]) => void
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

      if (content.kind === 'image') {
        await fsWebApi.uploadFile({
          path,
          file: new File([content.blob], filename, { type: content.mime }),
        })
      }
      else if (content.kind === 'html') {
        await fsWebApi.uploadFile({
          path,
          file: new File([content.text], filename, { type: 'text/html;charset=utf-8' }),
        })
      }
      else {
        await fsWebApi.uploadFile({
          path,
          file: generateTextFile(content.text, filename),
        })
      }

      window.$message.success(`Pasted ${filename}`)
      emit('refresh')
    }
    catch (error) {
      console.error('[pasteFromClipboard]', error)
      window.$message.error('Failed to paste from clipboard')
    }
    finally {
      isLoading.value = false
    }
  }

  return {
    handlePasteFromClipboard,
  }
}
