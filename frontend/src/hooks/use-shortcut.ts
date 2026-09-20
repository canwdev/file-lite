import type { InjectionKey, Ref } from 'vue'
import { computed, inject, onBeforeUnmount, shallowRef, unref } from 'vue'
import { appsStoreState } from '@/views/Apps/apps-store'

export type ShortcutScope = string
export type ShortcutCombo = string | string[]

export interface ShortcutOptions {
  allowInInput?: boolean
  disabled?: boolean | Ref<boolean>
  preventDefault?: boolean
  stopPropagation?: boolean
  description?: string
}

export interface UseShortcutOptions extends ShortcutOptions {
  scope: ShortcutScope
  combo: ShortcutCombo
  handler: (event: KeyboardEvent) => void
}

interface NormalizedCombo {
  key: string
  ctrl: boolean
  meta: boolean
  alt: boolean
  shift: boolean
}

interface ShortcutRegistration {
  id: symbol
  scope: ShortcutScope
  combos: NormalizedCombo[]
  /** 原始 combo 字符串，供列表展示 */
  comboLabels: string[]
  description: string
  handler: (event: KeyboardEvent) => void
  allowInInput: boolean
  disabled?: boolean | Ref<boolean>
  preventDefault: boolean
  stopPropagation: boolean
}

/** 一条可供 UI 展示的快捷键（实时注册表快照） */
export interface ListedShortcut {
  scope: string
  combos: string[]
  description: string
  disabled: boolean
  allowInInput: boolean
}

export const shortcutScopeKey: InjectionKey<string> = Symbol('shortcut-scope')

/** 外壳级 scope：先于面板 / App 的 scope 匹配，且在有活动 App 窗口时不触发 */
export const SHELL_SHORTCUT_SCOPE = 'shell'

const allRegistrations = new Map<symbol, ShortcutRegistration>()
const registrationsByScope = new Map<ShortcutScope, Set<symbol>>()
/** 注册表变更计数：列表 UI 靠它刷新 */
const registryVersion = shallowRef(0)
let listenerBound = false

function bumpRegistry() {
  registryVersion.value++
}

function normalizeEventKey(key: string): string {
  const normalized = key.toLowerCase()
  if (normalized === ' ')
    return 'space'
  if (normalized === 'esc')
    return 'escape'
  if (normalized === 'left')
    return 'arrowleft'
  if (normalized === 'right')
    return 'arrowright'
  if (normalized === 'up')
    return 'arrowup'
  if (normalized === 'down')
    return 'arrowdown'
  if (normalized === 'del')
    return 'delete'
  return normalized
}

function normalizeCombo(combo: string): NormalizedCombo | null {
  const parts = combo.toLowerCase().split('+').map(part => part.trim()).filter(Boolean)
  const normalized: NormalizedCombo = {
    key: '',
    ctrl: false,
    meta: false,
    alt: false,
    shift: false,
  }

  for (const part of parts) {
    if (part === 'ctrl') {
      normalized.ctrl = true
    }
    else if (part === 'meta' || part === 'cmd') {
      normalized.meta = true
    }
    else if (part === 'alt') {
      normalized.alt = true
    }
    else if (part === 'shift') {
      normalized.shift = true
    }
    else {
      normalized.key = part
    }
  }

  if (!normalized.key)
    return null

  normalized.key = normalizeEventKey(normalized.key)
  return normalized
}

function normalizeCombos(combo: ShortcutCombo): NormalizedCombo[] {
  const combos = Array.isArray(combo) ? combo : [combo]
  return combos
    .map(normalizeCombo)
    .filter((item): item is NormalizedCombo => item !== null)
}

function comboLabelList(combo: ShortcutCombo): string[] {
  return (Array.isArray(combo) ? combo : [combo]).map(item => item.trim()).filter(Boolean)
}

/** 把 `ctrl+r` / `arrowup` 之类格式化成菜单里那种 `Ctrl+R` */
export function formatShortcutCombo(combo: string): string {
  return combo
    .split('+')
    .map((part) => {
      const p = part.trim().toLowerCase()
      if (!p)
        return ''
      if (p === 'ctrl')
        return 'Ctrl'
      if (p === 'meta' || p === 'cmd')
        return 'Cmd'
      if (p === 'alt')
        return 'Alt'
      if (p === 'shift')
        return 'Shift'
      if (p === 'arrowup')
        return '↑'
      if (p === 'arrowdown')
        return '↓'
      if (p === 'arrowleft')
        return '←'
      if (p === 'arrowright')
        return '→'
      if (p === 'escape' || p === 'esc')
        return 'Esc'
      if (p === 'delete' || p === 'del')
        return 'Del'
      if (p === ' ')
        return 'Space'
      if (p === 'space')
        return 'Space'
      if (p === 'enter' || p === 'return')
        return 'Enter'
      if (p === 'backspace')
        return 'Backspace'
      if (p === 'pageup')
        return 'PageUp'
      if (p === 'pagedown')
        return 'PageDown'
      if (/^f\d{1,2}$/.test(p))
        return p.toUpperCase()
      if (p.length === 1)
        return p.toUpperCase()
      return p.replace(/^\w/, c => c.toUpperCase())
    })
    .filter(Boolean)
    .join('+')
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement))
    return false

  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

function getFallbackScope(): ShortcutScope | null {
  const activeId = appsStoreState.activeId
  if (!activeId)
    return null

  const activeWindow = appsStoreState.windows.find(
    window => window.id === activeId && !window.minimized && !window.isClosing,
  )
  return activeWindow ? `app:${activeWindow.id}` : null
}

function resolveTargetScope(target: EventTarget | null): ShortcutScope | null {
  if (target instanceof Element) {
    const scopeEl = target.closest('[data-shortcut-scope]')
    const scope = scopeEl?.getAttribute('data-shortcut-scope')
    if (scope)
      return scope
  }

  return getFallbackScope()
}

function comboMatches(combo: NormalizedCombo, event: KeyboardEvent): boolean {
  const eventKey = normalizeEventKey(event.key)

  // `?` 在常见布局上就是 Shift+/，event.key 为 '?' 且 shiftKey 为 true；匹配时忽略 shift
  if (combo.key === '?') {
    if (eventKey !== '?')
      return false
    return (
      combo.ctrl === event.ctrlKey
      && combo.meta === event.metaKey
      && combo.alt === event.altKey
    )
  }

  if (combo.key !== eventKey)
    return false

  return (
    combo.ctrl === event.ctrlKey
    && combo.meta === event.metaKey
    && combo.alt === event.altKey
    && combo.shift === event.shiftKey
  )
}

/** @returns 是否已命中并执行 */
function dispatchScope(scope: ShortcutScope, event: KeyboardEvent, editable: boolean): boolean {
  const ids = registrationsByScope.get(scope)
  if (!ids)
    return false

  for (const id of ids) {
    const registration = allRegistrations.get(id)
    if (!registration)
      continue

    if (registration.disabled && unref(registration.disabled))
      continue

    if (editable && !registration.allowInInput)
      continue

    if (!registration.combos.some(combo => comboMatches(combo, event)))
      continue

    if (registration.preventDefault)
      event.preventDefault()

    if (registration.stopPropagation)
      event.stopPropagation()

    registration.handler(event)
    return true
  }

  return false
}

function handleKeydown(event: KeyboardEvent) {
  if (event.defaultPrevented)
    return

  const editable = isEditableTarget(event.target)

  // 外壳级始终先试：具体快捷键用 disabled 自己避开 App / 选择器
  if (dispatchScope(SHELL_SHORTCUT_SCOPE, event, editable))
    return

  const scope = resolveTargetScope(event.target)
  if (!scope || scope === SHELL_SHORTCUT_SCOPE)
    return

  dispatchScope(scope, event, editable)
}

function ensureListener() {
  if (listenerBound || typeof document === 'undefined')
    return

  document.addEventListener('keydown', handleKeydown)
  listenerBound = true
}

function register(id: symbol, scope: ShortcutScope, registration: ShortcutRegistration) {
  allRegistrations.set(id, registration)

  let ids = registrationsByScope.get(scope)
  if (!ids) {
    ids = new Set()
    registrationsByScope.set(scope, ids)
  }
  ids.add(id)

  ensureListener()
  bumpRegistry()
}

function unregister(id: symbol) {
  const registration = allRegistrations.get(id)
  if (!registration)
    return

  allRegistrations.delete(id)
  const ids = registrationsByScope.get(registration.scope)
  ids?.delete(id)

  if (ids && ids.size === 0)
    registrationsByScope.delete(registration.scope)

  bumpRegistry()
}

export function injectShortcutScope(defaultScope?: ShortcutScope): ShortcutScope {
  const scope = inject(shortcutScopeKey, defaultScope)
  if (!scope) {
    throw new Error(
      'No shortcut scope was provided. Mount the component inside ShortcutScopeProvider or pass a default scope.',
    )
  }
  return scope
}

export function useShortcut(options: UseShortcutOptions) {
  const id = Symbol('shortcut')
  const registration: ShortcutRegistration = {
    id,
    scope: options.scope,
    combos: normalizeCombos(options.combo),
    comboLabels: comboLabelList(options.combo),
    description: options.description?.trim() ?? '',
    handler: options.handler,
    allowInInput: options.allowInInput ?? false,
    disabled: options.disabled,
    preventDefault: options.preventDefault ?? true,
    stopPropagation: options.stopPropagation ?? false,
  }

  register(id, registration.scope, registration)
  onBeforeUnmount(() => unregister(id))
}

/** 当前已通过 `useShortcut` 注册的快捷键快照（按 scope、combo 排序） */
export function listRegisteredShortcuts(): ListedShortcut[] {
  const items: ListedShortcut[] = []
  const seen = new Set<string>()
  for (const reg of allRegistrations.values()) {
    const combos = reg.comboLabels.map(formatShortcutCombo)
    // 同 scope 同键只留先注册的（App 专属 Esc 优先于外壳默认关窗）
    const dedupeKey = `${reg.scope}\0${combos.join('\0')}`
    if (seen.has(dedupeKey))
      continue
    seen.add(dedupeKey)
    items.push({
      scope: reg.scope,
      combos,
      description: reg.description,
      disabled: Boolean(reg.disabled && unref(reg.disabled)),
      allowInInput: reg.allowInInput,
    })
  }
  return items.sort((a, b) => {
    const scopeCmp = a.scope.localeCompare(b.scope)
    if (scopeCmp !== 0)
      return scopeCmp
    return a.combos.join(' ').localeCompare(b.combos.join(' '))
  })
}

/** 响应式列表：注册 / 卸载时自动更新 */
export function useShortcutRegistry() {
  return computed(() => {
    void registryVersion.value
    return listRegisteredShortcuts()
  })
}
