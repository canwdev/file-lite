export type ClipboardContent
  = | { kind: 'image', blob: Blob, mime: string, ext: string }
    | { kind: 'html', text: string, mime: string, ext: string }
    | { kind: 'text', text: string, mime: string, ext: string }

const IMAGE_MIME_EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
}

function imageExtFromMime(mime: string) {
  return IMAGE_MIME_EXT[mime] ?? '.png'
}

function pickImageType(types: readonly string[]) {
  const preferred = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
  for (const mime of preferred) {
    if (types.includes(mime))
      return mime
  }
  return types.find(type => type.startsWith('image/'))
}

function normalizeHtml(text: string) {
  const trimmed = text.trim()
  if (!trimmed)
    return ''
  if (/<!doctype\s+html/i.test(trimmed) || /<html[\s>]/i.test(trimmed))
    return trimmed
  return `<!DOCTYPE html>\n<html>\n<head>\n<meta charset="utf-8">\n</head>\n<body>\n${trimmed}\n</body>\n</html>\n`
}

async function parseClipboardItem(item: ClipboardItem): Promise<ClipboardContent | null> {
  const types = item.types
  const imageType = pickImageType(types)
  if (imageType) {
    const blob = await item.getType(imageType)
    return { kind: 'image', blob, mime: imageType, ext: imageExtFromMime(imageType) }
  }
  if (types.includes('text/html')) {
    const blob = await item.getType('text/html')
    const text = normalizeHtml(await blob.text())
    if (text)
      return { kind: 'html', text, mime: 'text/html', ext: '.html' }
  }
  if (types.includes('text/plain')) {
    const blob = await item.getType('text/plain')
    const text = await blob.text()
    if (text)
      return { kind: 'text', text, mime: 'text/plain', ext: '.txt' }
  }
  return null
}

async function readViaClipboardItems(): Promise<ClipboardContent | null> {
  const items = await navigator.clipboard.read()
  for (const item of items) {
    const content = await parseClipboardItem(item)
    if (content)
      return content
  }
  return null
}

async function readViaClipboardText(): Promise<ClipboardContent | null> {
  if (!navigator.clipboard?.readText)
    return null
  const text = await navigator.clipboard.readText()
  if (!text)
    return null
  return { kind: 'text', text, mime: 'text/plain', ext: '.txt' }
}

export async function readSystemClipboard(): Promise<ClipboardContent | null> {
  if (!navigator.clipboard)
    throw new Error('Clipboard API is not available')

  if (typeof ClipboardItem !== 'undefined' && typeof navigator.clipboard.read === 'function') {
    const content = await readViaClipboardItems()
    if (content)
      return content
  }

  return readViaClipboardText()
}
