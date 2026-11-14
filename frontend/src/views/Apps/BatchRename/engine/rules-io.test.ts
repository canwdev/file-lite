import type { RenameRule, RuleConfig } from './types'
import { describe, expect, test } from 'bun:test'
import { parseRulesJson, serializeRules } from './rules-io'
import { getDefaultConfig } from './types'

function rule(type: 'template' | 'findReplace'): RenameRule {
  const ruleConfig = getDefaultConfig(type)
  if (ruleConfig.type === 'template')
    ruleConfig.config.template = '{folder}_{name}'
  if (ruleConfig.type === 'findReplace') {
    ruleConfig.config.find = 'a'
    ruleConfig.config.replace = 'b'
  }
  return { id: 'internal-id', enabled: true, ruleConfig }
}

function templateConfig(config: RuleConfig) {
  if (config.type !== 'template')
    throw new Error('expected a template rule')
  return config.config
}

describe('Batch Rename rules file', () => {
  test('round-trips rules without leaking internal ids', () => {
    const json = serializeRules([rule('template'), rule('findReplace')])
    expect(json.includes('"id"')).toBe(false)

    const parsed = parseRulesJson(json)
    expect(parsed.length).toBe(2)
    const template = templateConfig(parsed[0].ruleConfig)
    expect(template.template).toBe('{folder}_{name}')
    expect(template.sequence.start).toBe(1)
    expect(parsed[1].ruleConfig.type).toBe('findReplace')
  })

  test('accepts a bare rules array and fills missing defaults', () => {
    const parsed = parseRulesJson(`\uFEFF${JSON.stringify([
      { enabled: false, ruleConfig: { type: 'template', config: { template: '{n}' } } },
    ])}`)
    expect(parsed[0].enabled).toBe(false)
    const template = templateConfig(parsed[0].ruleConfig)
    expect(template.template).toBe('{n}')
    expect(template.sequence.seqType).toBe('numeric')
  })

  test('rejects invalid json, unknown types and unknown rule types', () => {
    expect(() => parseRulesJson('not json')).toThrow()
    expect(() => parseRulesJson('{"rules":{}}')).toThrow()
    expect(() => parseRulesJson('{"rules":[{"ruleConfig":{"type":"customJs","config":{}}}]}')).toThrow()
  })
})
