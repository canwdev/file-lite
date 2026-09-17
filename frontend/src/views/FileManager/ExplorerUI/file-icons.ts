import type { IEntry } from '@/types/server'
import {
  regArchiveFormat,
  regAudioFormat,
  regExcelFormat,
  regImageFormat,
  regPdfFormat,
  regPowerpointFormat,
  regSupportedTextFormat,
  regVideoFormat,
  regWindowsFormat,
  regWordFormat,
} from '@/utils/is'

export function getFileIconClass(item?: IEntry) {
  if (!item) {
    return 'mdi-file-question-outline'
  }
  const { isDirectory, ext } = item
  if (isDirectory) {
    return 'mdi-folder-outline'
  }
  if (regArchiveFormat.test(ext)) {
    return `mdi-zip-box`
  }
  if (regImageFormat.test(ext)) {
    return `mdi-file-image-outline`
  }
  if (regAudioFormat.test(ext)) {
    return `mdi-music-circle-outline`
  }
  if (regVideoFormat.test(ext)) {
    return `mdi-file-video-outline`
  }
  if (regWindowsFormat.test(ext)) {
    return `mdi-microsoft`
  }
  if (regPdfFormat.test(ext)) {
    return `mdi-file-pdf-outline`
  }
  if (regExcelFormat.test(ext)) {
    return `mdi-file-excel-outline`
  }
  if (regWordFormat.test(ext)) {
    return `mdi-file-word-outline`
  }
  if (regPowerpointFormat.test(ext)) {
    return `mdi-file-powerpoint-outline`
  }
  if (regSupportedTextFormat.test(ext)) {
    if (/.vue$/.test(ext)) {
      return `mdi-vuejs`
    }
    if (/.json$/.test(ext)) {
      return `mdi-code-json`
    }
    if (/.html|htm|hta$/.test(ext)) {
      return `mdi-language-html5`
    }
    if (/.css|sass|styl|less$/.test(ext)) {
      return `mdi-language-css3`
    }
    if (/.js|jsx$/.test(ext)) {
      return `mdi-language-javascript`
    }
    if (/.ts|tsx$/.test(ext)) {
      return `mdi-code-json`
    }
    if (/.md$/.test(ext)) {
      return `mdi-language-markdown-outline`
    }
    return `mdi-file-document-outline`
  }
  return 'mdi-file-question-outline'
}
