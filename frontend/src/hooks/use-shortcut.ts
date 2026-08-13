import type { InjectionKey, Ref } from 'vue'
import { inject, onBeforeUnmount, unref } from 'vue'
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
  handler: (event: KeyboardEvent) => void
  allowInInput: boolean
  disabled?: boolean | Ref<boolean>
  preventDefault: boolean
  stopPropagation: boolean
}

export const shortcutScopeKey: InjectionKey<string> = Symbol('shortcut-scope')

const allRegistrations = new Map<symbol, ShortcutRegistration>()
const registrationsByScope = new Map<ShortcutScope, Set<symbol>>()
let listenerBound = false

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
  if (combo.key !== normalizeEventKey(event.key))
    return false

  return (
    combo.ctrl === event.ctrlKey
    && combo.meta === event.metaKey
    && combo.alt === event.altKey
    && combo.shift === event.shiftKey
  )
}

function handleKeydown(event: KeyboardEvent) {
  const scope = resolveTargetScope(event.target)
  if (!scope)
    return

  const ids = registrationsByScope.get(scope)
  if (!ids)
    return

  const editable = isEditableTarget(event.target)

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
    return
  }
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
    handler: options.handler,
    allowInInput: options.allowInInput ?? false,
    disabled: options.disabled,
    preventDefault: options.preventDefault ?? true,
    stopPropagation: options.stopPropagation ?? false,
  }

  register(id, registration.scope, registration)
  onBeforeUnmount(() => unregister(id))
}
