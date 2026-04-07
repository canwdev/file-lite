export function normalizePath(path: string) {
  return path.replace(/\\/g, '/').replace(/\/+/g, '/')
}

/** 与列表/导航使用的路径一致：正斜杠、末尾 `/`（空路径视为 `/`） */
export function normalizeListingPath(path: string) {
  let p = normalizePath(path)
  if (!p) {
    p = '/'
  }
  if (!/\/$/.test(p)) {
    p += '/'
  }
  return p
}

export function toggleArrayElement(arr: any[], value: any) {
  const index = arr.indexOf(value)
  if (index !== -1) {
    arr.splice(index, 1)
  }
  else {
    arr.push(value)
  }
  return arr
}

export function getLastDirName(path: string) {
  path = path.replace(/\/$/g, '')
  return path.split('/').pop()
}

export function generateTextFile(text: string, name: string) {
  // 创建一个 Blob 对象，将输入的文本转换为文本文件
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
  return new File([blob], name)
}

export function getExtension(name: string) {
  if (!name || !name.includes('.') || name.startsWith('.'))
    return ''
  return name.split('.').reverse()[0].toLowerCase()
}
