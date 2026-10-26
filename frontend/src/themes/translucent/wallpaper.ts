const CSS_VARIABLE = '--file-lite-wallpaper'
const MAX_INPUT_BYTES = 10 * 1024 * 1024
const MAX_OUTPUT_BYTES = 1.5 * 1024 * 1024
const START_DIMENSION = 2560
const MIN_DIMENSION = 1280
const START_QUALITY = 0.82
const MIN_QUALITY = 0.6

export function applyWallpaperCssVariable(url: string) {
  const root = document.documentElement
  if (!url) {
    root.style.removeProperty(CSS_VARIABLE)
    return
  }
  root.style.setProperty(CSS_VARIABLE, `url(${JSON.stringify(url)})`)
}

/** Best-effort check: let the browser fetch and decode the URL as an image. */
export function canLoadImage(url: string, timeoutMs = 10000): Promise<boolean> {
  return new Promise((resolve) => {
    const image = new Image()
    const timer = window.setTimeout(finish, timeoutMs, false)

    function finish(ok: boolean) {
      window.clearTimeout(timer)
      image.onload = null
      image.onerror = null
      resolve(ok)
    }

    image.onload = () => finish(true)
    image.onerror = () => finish(false)
    image.src = url
  })
}

export function dataUrlToBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(',')
  if (comma < 0)
    return 0
  return Math.ceil(((dataUrl.length - comma - 1) * 3) / 4)
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024)
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  if (bytes >= 1024)
    return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}

type LoadedImage = ImageBitmap | HTMLImageElement

async function loadImage(file: File): Promise<LoadedImage> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file)
    }
    catch {
      // Fall through to <img> for formats createImageBitmap cannot decode.
    }
  }

  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(objectUrl)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('Could not read this image.'))
    }
    image.src = objectUrl
  })
}

/**
 * Rasterize the upload as a JPEG, shrinking both dimensions and quality until it
 * fits comfortably in the local settings store (~2 MB as base64).
 */
export async function optimizeImageFile(file: File): Promise<string> {
  if (file.type && !file.type.startsWith('image/'))
    throw new Error('Only image files are supported.')
  if (file.size > MAX_INPUT_BYTES)
    throw new Error('The image must be 10 MB or smaller.')

  const image = await loadImage(file)
  const width = image.width
  const height = image.height
  if (!width || !height) {
    if ('close' in image)
      image.close()
    throw new Error('Could not read this image.')
  }

  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) {
    if ('close' in image)
      image.close()
    throw new Error('This browser cannot optimize images.')
  }

  let dimension = START_DIMENSION
  let quality = START_QUALITY
  let dataUrl = ''

  try {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const scale = Math.min(1, dimension / Math.max(width, height))
      const targetWidth = Math.max(1, Math.round(width * scale))
      const targetHeight = Math.max(1, Math.round(height * scale))

      canvas.width = targetWidth
      canvas.height = targetHeight
      context.imageSmoothingEnabled = true
      context.imageSmoothingQuality = 'high'
      // JPEG has no alpha; fill first so transparent images do not turn black by accident.
      context.fillStyle = '#111'
      context.fillRect(0, 0, targetWidth, targetHeight)
      context.drawImage(image, 0, 0, targetWidth, targetHeight)

      dataUrl = canvas.toDataURL('image/jpeg', quality)
      if (dataUrlToBytes(dataUrl) <= MAX_OUTPUT_BYTES)
        break

      if (quality > MIN_QUALITY) {
        quality = Math.max(MIN_QUALITY, quality - 0.08)
      }
      else if (dimension > MIN_DIMENSION) {
        dimension = Math.max(MIN_DIMENSION, Math.round(dimension * 0.8))
      }
      else {
        break
      }
    }
  }
  finally {
    if ('close' in image)
      image.close()
  }

  if (!dataUrl)
    throw new Error('Could not optimize this image.')
  if (dataUrlToBytes(dataUrl) > MAX_OUTPUT_BYTES)
    throw new Error('The image is still too large after optimization. Try a smaller image.')
  return dataUrl
}
