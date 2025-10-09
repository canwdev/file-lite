export const shortcutFilenameReg = /\.shortcut$/i

export const regArchiveFormat
  = /\.(zip|rar|tar|gz|bz2|7z|xz|tgz|zipx|tar\.gz|tar\.bz2|z|lzh|arj|zoo|pkg|lz|7zip|cab|iso|dmg|apk)$/i
export const regImageFormat = /\.(jpg|jpeg|png|gif|bmp|svg|webp|tiff?|heif|indd|ico)$/i
export const regExeFormat = /\.(exe|msi)$/i
export const regVideoFormat = /\.(mp4|mkv|avi|mov|wmv|flv|webm|m4v|mpeg|mpg|3gp)$/i
export const regAudioFormat = /\.(mp3|wav|aac|flac|ogg|m4a|wma|opus)$/i

export const regSupportedTextFormat
  = /\.(txt|csv|md|log|lock|ini|conf|config|json|js|mjs|cjs|jsx|ts|tsx|py|java|c|cpp|h|cs|rb|go|php|html|htm|hta|xml|yaml|css|scss|sass|styl|less|vue|bat|cmd|sh)$/i
export const regSupportedImageFormat = regImageFormat // /\.(jpg|jpeg|png|gif|webp|svg)$/i
export const regSupportedVideoFormat = regVideoFormat // /\.(mp4|webm|ogg|mov)$/i
export const regSupportedAudioFormat = regAudioFormat // /\.(mp3|wav|ogg|aac|flac|opus)$/i
export function isSupportedMediaFormat(name: string) {
  return regSupportedAudioFormat.test(name) || regSupportedVideoFormat.test(name)
}

// 是否外部链接
export function isOutLink(url: string) {
  // eslint-disable-next-line regexp/no-dupe-disjunctions
  return /^(https?:|mailto:|tel:|[a-zA-Z]{4,}:)/.test(url)
}

export function isBase64Image(str: string) {
  return /^data:image\/([a-zA-Z]*);base64,/.test(str)
}

export function isSrcHttpUrl(url: string) {
  return /^(https?:)/i.test(url)
}

export function isUrlImage(url: string) {
  return /\.(?:jpg|jpeg|jfif|pjpeg|pjp|gif|apng|png|webp|svg|avif)$/i.test(url)
}
