export interface FileEntry {
  id: string
  /** Full canonical path in the file manager. */
  path: string
  name: string // full name with extension
  baseName: string // name without extension
  extension: string // extension with dot, e.g. ".jpg"
  selected: boolean
  relativePath?: string // relative path from imported folder root, e.g. "sub/dir/file.jpg"
  size?: number | null // file size in bytes
  modified?: number // last modified timestamp
}

export interface RuleContext {
  index: number
  totalFiles?: number
  ext: string
  originalName: string
  currentName?: string // Name after the rules processed so far, used by sequence templates
  folderName?: string
  relativePath?: string
  size?: number | null
  modified?: number
}

/** Options object passed to custom JS rename function */
export interface CustomJsOptions {
  name: string
  ext: string
  fullName: string
  index: number
  size?: number
  modifiedTime?: number
}

export type ExtensionScope = 'name' | 'extension' | 'full'

export type RuleType
  = | 'findReplace'
    | 'template'
    | 'caseStyle'
    | 'customJs'
    | 'removeCleanup'

export interface FindReplaceConfig {
  find: string
  replace: string
  caseSensitive: boolean
  matchAll: boolean
  useRegex: boolean
  regexFlags: string
  usePosition: boolean
  fromEnd: boolean
  positionStart: number
  positionCount: number
}

export interface TemplateConfig {
  template: string
  sequence: SequenceConfig
}

export interface SequenceConfig {
  seqType: 'numeric' | 'alpha' | 'roman'
  start: number
  step: number
  /** Derive the digit count from the number of files in the sequence group. */
  paddingAuto: boolean
  padding: number
  // Scope: how sequence index is calculated
  scope: 'global' | 'perFolder' | 'perExtension' | 'perCategory'
  // Sort before numbering
  sortBeforeNumbering: boolean
  sortBy: 'name' | 'size' | 'modified' | 'extension'
  sortOrder: 'asc' | 'desc'
  naturalSort: boolean
  // Preserve original numbers
  preserveOriginal: boolean
  preservePattern: string // regex to extract original number
  // Hierarchical numbering
  hierarchical: boolean
  hierarchySeparator: string // ".", "-", "_"
}

export interface CaseStyleConfig {
  mode:
    | 'uppercase'
    | 'lowercase'
    | 'titlecase'
    | 'sentencecase'
    | 'camelCase'
    | 'PascalCase'
    | 'kebab-case'
    | 'snake_case'
    | 'none'
  style: 'none' | 'spaceToDash' | 'spaceToUnderscore' | 'dashToSpace' | 'underscoreToSpace'
}

export interface CustomJsConfig {
  code: string
  lastError?: string
}

export interface RemoveCleanupConfig {
  mode: 'chars' | 'range' | 'cleanup'
  // chars mode
  direction: 'start' | 'end'
  count: number
  // range mode
  rangeStart: number
  rangeEnd: number
  // cleanup mode - multiple flags
  removeDigits: boolean
  removeSymbols: boolean
  removeSpaces: boolean
  removeChinese: boolean
  removeEnglish: boolean
}

export type RuleConfig
  = | { type: 'findReplace', config: FindReplaceConfig }
    | { type: 'template', config: TemplateConfig }
    | { type: 'caseStyle', config: CaseStyleConfig }
    | { type: 'customJs', config: CustomJsConfig }
    | { type: 'removeCleanup', config: RemoveCleanupConfig }

export interface RenameRule {
  id: string
  enabled: boolean
  ruleConfig: RuleConfig
}

export interface PreviewResult {
  fileId: string
  original: string
  newName: string
  hasChange: boolean
  conflict: boolean
  error?: string
  errorDetail?: string
  dirPath?: string
}

export function getDefaultConfig(type: RuleType): RuleConfig {
  switch (type) {
    case 'findReplace':
      return {
        type,
        config: {
          find: '',
          replace: '',
          caseSensitive: false,
          matchAll: true,
          useRegex: false,
          regexFlags: 'g',
          usePosition: false,
          fromEnd: false,
          positionStart: 0,
          positionCount: 1,
        },
      }
    case 'template':
      return {
        type,
        config: {
          template: '',
          sequence: {
            seqType: 'numeric',
            start: 1,
            step: 1,
            paddingAuto: true,
            padding: 3,
            scope: 'global',
            sortBeforeNumbering: false,
            sortBy: 'name',
            sortOrder: 'asc',
            naturalSort: true,
            preserveOriginal: false,
            preservePattern: '(\\d+)',
            hierarchical: false,
            hierarchySeparator: '.',
          },
        },
      }
    case 'caseStyle':
      return { type, config: { mode: 'lowercase', style: 'none' } }
    case 'customJs':
      return {
        type,
        config: {
          code: `/**
 * @param {Object} options
 * @param {string} options.name - File name without extension
 * @param {string} options.ext - Extension without the dot, e.g. "jpg"
 * @param {string} options.fullName - Complete file name
 * @param {number} options.index - Index starting at 0
 * @param {number} [options.size] - File size in bytes
 * @param {number} [options.modifiedTime] - Last modified timestamp
 * @returns {string} New file name without extension
 */
function rename(options) {
  const { name, ext, index } = options;
  // your code here
  return name;
}`,
        },
      }
    case 'removeCleanup':
      return {
        type,
        config: {
          mode: 'chars',
          direction: 'start',
          count: 1,
          rangeStart: 0,
          rangeEnd: 1,
          removeDigits: false,
          removeSymbols: false,
          removeSpaces: false,
          removeChinese: false,
          removeEnglish: false,
        },
      }
  }
}

export type PresetCategory = 'photo' | 'document' | 'code' | 'video' | 'music' | 'general'

export type PresetSortMode = 'recent' | 'frequent' | 'name' | 'created'

export interface UserPreset {
  extensionScope?: ExtensionScope
  id: string
  name: string
  description?: string
  tags?: string[]
  category?: PresetCategory
  rules: RuleConfig[]
  createdAt: number
  lastUsedAt: number
  usageCount: number
  isPinned?: boolean
}

export interface PresetPinned {
  type: 'system' | 'user'
  id: string
  pinnedAt: number
}

// Filter types
export type FilterField = 'name' | 'extension' | 'size' | 'modified'
export type FilterOperator
  = | 'contains'
    | 'notContains'
    | 'equals'
    | 'notEquals'
    | 'startsWith'
    | 'endsWith'
    | 'regex'
    | 'greaterThan'
    | 'lessThan'

export interface FilterCondition {
  id: string
  field: FilterField
  operator: FilterOperator
  value: string
  caseSensitive?: boolean
}

export interface FileFilter {
  conditions: FilterCondition[]
  logic: 'AND' | 'OR'
}
