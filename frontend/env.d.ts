/// <reference types="vite/client" />

declare module '@canwdev/vgo-ui/styles'

interface Window {
  showDirectoryPicker?: (options?: { id?: string, mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>
}
