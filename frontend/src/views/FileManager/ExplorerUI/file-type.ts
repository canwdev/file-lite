import type { IEntry } from '@/types/server'
import {
  regArchiveFormat,
  regAudioFormat,
  regImageFormat,
  regSupportedTextFormat,
  regVideoFormat,
  regWindowsExeFormat,
} from '@/utils/is'

/** 常见扩展名的 Windows 风格类型名；未命中时回落到 `${EXT} File`。 */
const EXT_TYPE_LABELS: Record<string, string> = {
  '.png': 'PNG Image',
  '.jpg': 'JPEG Image',
  '.jpeg': 'JPEG Image',
  '.gif': 'GIF Image',
  '.webp': 'WebP Image',
  '.svg': 'SVG Document',
  '.bmp': 'Bitmap Image',
  '.ico': 'Icon',
  '.mp3': 'MP3 Audio',
  '.wav': 'WAV Audio',
  '.flac': 'FLAC Audio',
  '.m4a': 'M4A Audio',
  '.mp4': 'MP4 Video',
  '.mkv': 'MKV Video',
  '.avi': 'AVI Video',
  '.mov': 'MOV Video',
  '.webm': 'WebM Video',
  '.zip': 'ZIP Archive',
  '.rar': 'RAR Archive',
  '.7z': '7-Zip Archive',
  '.tar': 'TAR Archive',
  '.gz': 'GZip Archive',
  '.pdf': 'PDF Document',
  '.txt': 'Text Document',
  '.md': 'Markdown Document',
  '.json': 'JSON File',
  '.html': 'HTML Document',
  '.htm': 'HTML Document',
  '.css': 'CSS Stylesheet',
  '.scss': 'Sass Stylesheet',
  '.less': 'Less Stylesheet',
  '.js': 'JavaScript File',
  '.mjs': 'JavaScript File',
  '.ts': 'TypeScript File',
  '.tsx': 'TypeScript File',
  '.vue': 'Vue Component',
  '.py': 'Python File',
  '.go': 'Go Source File',
  '.java': 'Java Source File',
  '.c': 'C Source File',
  '.cpp': 'C++ Source File',
  '.cs': 'C# Source File',
  '.sh': 'Shell Script',
  '.bat': 'Windows Batch File',
  '.cmd': 'Windows Command Script',
  '.ps1': 'PowerShell Script',
  '.xml': 'XML Document',
  '.yaml': 'YAML File',
  '.yml': 'YAML File',
  '.toml': 'TOML File',
  '.ini': 'Configuration Settings',
  '.log': 'Log File',
  '.csv': 'CSV File',
  '.exe': 'Application',
  '.msi': 'Windows Installer',
  '.dll': 'Application Extension',
  '.iso': 'Disc Image File',
}

/**
 * Windows 资源管理器风格的「类型」文案：目录固定为 File folder，
 * 其余按扩展名给出人类可读名，未知扩展名回落到 `${EXT} File`。
 */
export function getEntryTypeLabel(entry: Pick<IEntry, 'isDirectory' | 'ext'>) {
  if (entry.isDirectory) {
    return 'File folder'
  }
  const ext = (entry.ext || '').toLowerCase()
  if (!ext) {
    return 'File'
  }
  const known = EXT_TYPE_LABELS[ext]
  if (known) {
    return known
  }
  const upper = ext.slice(1).toUpperCase()
  if (regArchiveFormat.test(ext)) {
    return `${upper} Archive`
  }
  if (regImageFormat.test(ext)) {
    return `${upper} Image`
  }
  if (regAudioFormat.test(ext)) {
    return `${upper} Audio`
  }
  if (regVideoFormat.test(ext)) {
    return `${upper} Video`
  }
  if (regWindowsExeFormat.test(ext)) {
    return 'Application'
  }
  if (regSupportedTextFormat.test(ext)) {
    return `${upper} File`
  }
  return `${upper} File`
}
