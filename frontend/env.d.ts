/// <reference types="vite/client" />

interface Window {
  showDirectoryPicker?: (options?: { id?: string, mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>
}
