import type { FileEntry, RenameRule } from './types'
import { describe, expect, test } from 'bun:test'
import { computePreview, parentFolderName } from './rules'
import { getDefaultConfig } from './types'

function file(path: string): FileEntry {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  return {
    id: path,
    path,
    name,
    baseName: dot > 0 ? name.slice(0, dot) : name,
    extension: dot > 0 ? name.slice(dot) : '',
    isDirectory: false,
    selected: true,
    // The batch rename app stores the basename here, not a directory path.
    relativePath: name,
  }
}

function templateRule(template: string): RenameRule {
  const ruleConfig = getDefaultConfig('template')
  if (ruleConfig.type !== 'template')
    throw new Error('unexpected default rule type')
  ruleConfig.config.template = template
  return { id: 'template', enabled: true, ruleConfig }
}

describe('parent folder name token', () => {
  test('parentFolderName returns the immediate parent directory', () => {
    expect(parentFolderName('/root/sub1/same.txt')).toBe('sub1')
    expect(parentFolderName('D:/root/sub2/same.txt')).toBe('sub2')
    expect(parentFolderName('//server/share/docs/a.txt')).toBe('docs')
    expect(parentFolderName('/a.txt')).toBe('')
    expect(parentFolderName('D:/a.txt')).toBe('')
  })

  test('{folder}_{name} uses each file\'s own parent folder', () => {
    const rows = computePreview(
      [file('/root/sub1/same.txt'), file('/root/sub2/same.txt')],
      [templateRule('{folder}_{name}')],
      'name',
    )
    expect(rows.map(row => row.newName)).toEqual(['sub1_same.txt', 'sub2_same.txt'])
  })
})
