export interface FileFilterState {
  text: string
  regex: boolean
  caseSensitive: boolean
}

export function createDefaultFileFilter(): FileFilterState {
  return {
    text: '',
    regex: false,
    caseSensitive: false,
  }
}

export function isFileFilterActive(filter?: FileFilterState): boolean {
  return !!filter?.text.trim()
}
