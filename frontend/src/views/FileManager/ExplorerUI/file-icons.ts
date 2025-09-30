import type { IEntry } from '@server/types/server'
import {
  regArchiveFormat,
  regAudioFormat,
  regExeFormat,
  regImageFormat,
  regSupportedTextFormat,
  regVideoFormat,
} from '@/utils/is'

export function getFileIconClass(item?: IEntry) {
  if (!item) {
    return 'mdi-file-question'
  }
  const { isDirectory, ext } = item
  if (isDirectory) {
    return 'mdi-folder'
  }
  if (regArchiveFormat.test(ext)) {
    return `mdi-zip-box`
  }
  if (regImageFormat.test(ext)) {
    return `mdi-file-image`
  }
  if (regAudioFormat.test(ext)) {
    return `mdi-music-circle-outline`
  }
  if (regVideoFormat.test(ext)) {
    return `mdi-file-video-outline`
  }
  if (regExeFormat.test(ext)) {
    return `mdi-microsoft-windows`
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
    return `mdi-text-box-outline`
  }
  return 'mdi-file-question'
}
