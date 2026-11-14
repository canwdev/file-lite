import type { RenameRule, RuleConfig, RuleType } from './types'
import { getDefaultConfig } from './types'

/**
 * On-disk shape for Batch Rename rules.
 *
 * `id` is internal state and is regenerated on import, so exported files stay
 * small and hand-editable. A bare array is accepted on import for convenience.
 */
export interface RulesFile {
  version: 1
  rules: Array<{ enabled: boolean, ruleConfig: RuleConfig }>
}

const RULE_TYPES: RuleType[] = ['findReplace', 'template', 'caseStyle', 'removeCleanup']

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function serializeRules(rules: RenameRule[]): string {
  const file: RulesFile = {
    version: 1,
    rules: rules.map(rule => ({ enabled: rule.enabled, ruleConfig: rule.ruleConfig })),
  }
  return JSON.stringify(file, null, 2)
}

function normalizeRule(raw: unknown, index: number): Omit<RenameRule, 'id'> {
  if (!isRecord(raw) || !isRecord(raw.ruleConfig)) {
    throw new Error(`Rule ${index + 1} is not an object`)
  }
  const type = raw.ruleConfig.type
  if (typeof type !== 'string' || !RULE_TYPES.includes(type as RuleType)) {
    throw new Error(`Rule ${index + 1} has an unknown type`)
  }
  const ruleType = type as RuleType
  const defaults = getDefaultConfig(ruleType)
  const imported = isRecord(raw.ruleConfig.config) ? raw.ruleConfig.config : {}
  const config = {
    ...(defaults.config as unknown as Record<string, unknown>),
    ...imported,
  }
  if (ruleType === 'template') {
    const defaultSequence = (defaults.config as unknown as { sequence: Record<string, unknown> }).sequence
    config.sequence = {
      ...defaultSequence,
      ...(isRecord(imported.sequence) ? imported.sequence : {}),
    }
  }
  return {
    enabled: raw.enabled !== false,
    ruleConfig: { type: ruleType, config } as unknown as RuleConfig,
  }
}

export function parseRulesJson(text: string): Array<Omit<RenameRule, 'id'>> {
  let data: unknown
  try {
    data = JSON.parse(text.replace(/^\uFEFF/, ''))
  }
  catch {
    throw new Error('Invalid JSON')
  }
  const rawRules = Array.isArray(data)
    ? data
    : (isRecord(data) && Array.isArray(data.rules) ? data.rules : null)
  if (!rawRules) {
    throw new Error('Expected a rules array or a { rules: [...] } object')
  }
  return rawRules.map(normalizeRule)
}
