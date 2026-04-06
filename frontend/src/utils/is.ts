export const shortcutFilenameReg = /\.shortcut$/i

export const regArchiveFormat = /\.(?:zip|rar|7z|tar|gz|bz2|xz|tgz|tar\.gz|tar\.bz2|tar\.xz|zipx|z|lzh|arj|zoo|pkg|lz|cab|iso|dmg|apk|deb|rpm|jar|war|ear|zst|lz4|br|vhd|vhdx|wim)$/i

export const regImageFormat = /\.(?:jpg|jpeg|jfif|pjpeg|pjp|png|gif|apng|webp|svg|avif|bmp|tiff?|heif|indd|ico)$/i
export const regWindowsExeFormat = /\.(?:exe|msi|com|scr|cpl|msc|msp|pif|dll|sys|drv)$/i
export const regVideoFormat = /\.(mp4|mkv|avi|mov|wmv|flv|webm|m4v|mpeg|mpg|3gp|ogv)$/i
export const regAudioFormat = /\.(mp3|wav|aac|flac|ogg|m4a|wma|opus)$/i

export const regSupportedTextFormat = /\.(?:txt|csv|md|log|lock|ini|conf|config|json|js|mjs|cjs|jsx|ts|tsx|py|java|c|cpp|h|hpp|cs|rb|go|php|html|htm|hta|xml|yaml|yml|css|scss|sass|styl|less|vue|bat|cmd|ps1|sh|env|editorconfig|gitignore|gitattributes|dockerfile|makefile|sql|graphql|gql|jsonl|properties|toml|rtf|tex|bib|tsv|svg|map)$/i

export const regSupportedImageFormat = regImageFormat
export const regSupportedVideoFormat = regVideoFormat
export const regSupportedAudioFormat = regAudioFormat

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
