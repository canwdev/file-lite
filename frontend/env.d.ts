/// <reference types="vite/client" />
/// <reference types="unplugin-icons/types/vue" />

declare module '@canwdev/vgo-ui/styles/core'
declare module '@canwdev/vgo-ui/themes/default'

/**
 * `bun:test` 的最小类型声明。
 *
 * 前端用 Bun 作为包管理器与测试运行器（`bun test`，零依赖）。
 * 不引入 `bun-types` 是为了避免为一个测试模块新增 devDependency，
 * 这里只声明实际用到的 API；用到新 API 时按需补充。
 */
declare module 'bun:test' {
  interface Matchers {
    toBe(expected: unknown): void
    toEqual(expected: unknown): void
    toThrow(expected?: unknown): void
    toBeUndefined(): void
    not: Matchers
  }
  export function describe(label: string, fn: () => void): void
  export function test(label: string, fn: () => void | Promise<void>): void
  export namespace test {
    function each(cases: readonly unknown[]): (label: string, fn: (...args: any[]) => void) => void
    function skip(label: string, fn: () => void): void
  }
  export function expect(actual: unknown): Matchers
  export function beforeEach(fn: () => void | Promise<void>): void
  export function afterEach(fn: () => void | Promise<void>): void
}

interface Window {
  showDirectoryPicker?: (options?: { id?: string, mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>
}
