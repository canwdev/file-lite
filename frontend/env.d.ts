/// <reference types="vite/client" />

declare module '@canwdev/vgo-ui/styles/core'
declare module '@canwdev/vgo-ui/themes/default'

interface Window {
  showDirectoryPicker?: (options?: { id?: string, mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>
}
