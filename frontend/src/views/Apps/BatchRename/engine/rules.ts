import type {
  CaseStyleConfig,
  CustomJsOptions,
  ExtensionScope,
  FileEntry,
  FindReplaceConfig,
  PreviewResult,
  RemoveCleanupConfig,
  RenameRule,
  RuleContext,
  SequenceConfig,
  TemplateConfig,
} from './types'

function formatDate(date: Date, format: string): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  const second = String(date.getSeconds()).padStart(2, '0')

  return format
    .replace(/YYYY/g, String(year))
    .replace(/MM/g, month)
    .replace(/DD/g, day)
    .replace(/HH/g, hour)
    .replace(/mm/g, minute)
    .replace(/ss/g, second)
}

/** Dynamic template values must stay usable as a filename on every platform. */
function filenameSafe(value: string): string {
  return Array.from(value, (character) => {
    if (character.charCodeAt(0) < 32)
      return '-'
    return /[<>:"/\\|?*]/.test(character) ? '-' : character
  }).join('')
}

function resolveVariables(text: string, context: RuleContext): string {
  const now = new Date()

  return text
    .replace(/\{date\}/g, filenameSafe(now.toISOString().slice(0, 10).replaceAll('-', '')))
    .replace(/\{date:([^}]+)\}/g, (_, fmt) => filenameSafe(formatDate(now, fmt)))
    .replace(/\{timestamp\}/g, String(now.getTime()))
    .replace(/\{n\}/g, String(context.index + 1))
    .replace(/\{name\}/g, filenameSafe(context.currentName ?? context.originalName))
    .replace(/\{ext\}/g, filenameSafe(context.ext.replace(/^\./, '')))
}

function toAlpha(n: number): string {
  if (n <= 0)
    return ''
  let result = ''
  while (n > 0) {
    n--
    result = String.fromCharCode(65 + (n % 26)) + result
    n = Math.floor(n / 26)
  }
  return result
}

function toRoman(n: number): string {
  if (n <= 0 || n >= 4000)
    return String(n)
  const map: [number, string][] = [
    [1000, 'M'],
    [900, 'CM'],
    [500, 'D'],
    [400, 'CD'],
    [100, 'C'],
    [90, 'XC'],
    [50, 'L'],
    [40, 'XL'],
    [10, 'X'],
    [9, 'IX'],
    [5, 'V'],
    [4, 'IV'],
    [1, 'I'],
  ]
  let result = ''
  for (const [value, symbol] of map) {
    while (n >= value) {
      result += symbol
      n -= value
    }
  }
  return result
}

function getFileCategory(ext: string): string {
  const lowerExt = ext.toLowerCase()
  const categories: Record<string, string[]> = {
    image: [
      '.jpg',
      '.jpeg',
      '.png',
      '.gif',
      '.bmp',
      '.webp',
      '.svg',
      '.tiff',
      '.ico',
      '.heic',
      '.heif',
      '.avif',
    ],
    video: ['.mp4', '.mov', '.avi', '.mkv', '.wmv', '.flv', '.webm', '.m4v'],
    audio: ['.mp3', '.wav', '.flac', '.aac', '.ogg', '.wma', '.m4a'],
    document: ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.rtf', '.odt'],
    code: [
      '.js',
      '.ts',
      '.jsx',
      '.tsx',
      '.py',
      '.java',
      '.cpp',
      '.c',
      '.h',
      '.css',
      '.html',
      '.json',
      '.xml',
      '.yml',
      '.yaml',
    ],
  }
  for (const [cat, exts] of Object.entries(categories)) {
    if (exts.includes(lowerExt))
      return cat
  }
  return 'other'
}

function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
}

interface SequenceFileData {
  index: number
  seqValue?: string
}

function sequencePadding(config: SequenceConfig, fileCount: number) {
  if (!config.paddingAuto)
    return Math.max(1, config.padding)
  const last = config.start + Math.max(0, fileCount - 1) * config.step
  return Math.max(1, String(last).length)
}

function computeSequenceData(
  files: FileEntry[],
  config: SequenceConfig,
  getDirKey: (file: FileEntry) => string,
): Map<string, SequenceFileData> {
  const result = new Map<string, SequenceFileData>()

  // Preserve original numbers mode: extract number from filename and reformat
  // Files where extraction fails are skipped (no entry in map) and fall back to normal sequencing
  if (config.preserveOriginal) {
    for (const file of files) {
      try {
        const re = new RegExp(config.preservePattern)
        const match = file.baseName.match(re)
        if (match?.[1]) {
          const extractedNum = Number.parseInt(match[1], 10)
          if (!Number.isNaN(extractedNum) && extractedNum > 0) {
            let seqValue = String(extractedNum)
            switch (config.seqType) {
              case 'numeric':
                seqValue = String(extractedNum).padStart(sequencePadding(config, files.length), '0')
                break
              case 'alpha':
                seqValue = toAlpha(extractedNum)
                break
              case 'roman':
                seqValue = toRoman(extractedNum)
                break
            }
            result.set(file.id, { index: extractedNum, seqValue })
          }
        }
      }
      catch {
        // invalid regex, skip this file
      }
    }
    return result
  }

  // Group files by scope
  const groups = new Map<string, FileEntry[]>()
  for (const file of files) {
    let groupKey: string
    switch (config.scope) {
      case 'perFolder':
        groupKey = getDirKey(file)
        break
      case 'perExtension':
        groupKey = file.extension.toLowerCase()
        break
      case 'perCategory':
        groupKey = getFileCategory(file.extension)
        break
      default:
        groupKey = '__global__'
        break
    }
    if (!groups.has(groupKey))
      groups.set(groupKey, [])
    groups.get(groupKey)!.push(file)
  }

  // Sort within groups if needed
  if (config.sortBeforeNumbering) {
    for (const group of groups.values()) {
      group.sort((a, b) => {
        let cmp: number
        switch (config.sortBy) {
          case 'name':
            cmp = config.naturalSort
              ? naturalCompare(a.baseName, b.baseName)
              : a.baseName.localeCompare(b.baseName)
            break
          case 'size':
            cmp = (a.size ?? 0) - (b.size ?? 0)
            break
          case 'modified':
            cmp = (a.modified ?? 0) - (b.modified ?? 0)
            break
          case 'extension':
            cmp = a.extension.localeCompare(b.extension)
            break
          default:
            cmp = 0
        }
        return config.sortOrder === 'desc' ? -cmp : cmp
      })
    }
  }

  // Hierarchical numbering (requires non-global scope)
  if (config.hierarchical && config.scope !== 'global') {
    const groupKeys = [...groups.keys()].sort()
    for (let g = 0; g < groupKeys.length; g++) {
      const groupFiles = groups.get(groupKeys[g])!
      const level1 = config.start + g * config.step
      const pad = sequencePadding(config, groupFiles.length)
      for (let f = 0; f < groupFiles.length; f++) {
        const level2 = config.start + f * config.step
        let seqValue: string
        if (config.seqType === 'numeric') {
          const l1 = String(level1).padStart(pad, '0')
          const l2 = String(level2).padStart(pad, '0')
          seqValue = `${l1}${config.hierarchySeparator}${l2}`
        }
        else {
          const fmt = config.seqType === 'alpha' ? toAlpha : toRoman
          seqValue = `${fmt(level1)}${config.hierarchySeparator}${fmt(level2)}`
        }
        result.set(groupFiles[f].id, { index: f, seqValue })
      }
    }
    return result
  }

  // Regular indexing within groups
  for (const group of groups.values()) {
    const pad = sequencePadding(config, group.length)
    for (let i = 0; i < group.length; i++) {
      const value = config.start + i * config.step
      const seqValue = config.seqType === 'numeric' && config.paddingAuto
        ? String(value).padStart(pad, '0')
        : undefined
      result.set(group[i].id, { index: i, seqValue })
    }
  }

  return result
}

function applyFindReplace(name: string, c: FindReplaceConfig): string {
  if (!c.find)
    return name
  if (c.useRegex) {
    let flags = c.regexFlags || 'g'
    if (!c.caseSensitive && !flags.includes('i'))
      flags += 'i'
    if (c.caseSensitive)
      flags = flags.replaceAll('i', '')
    if (c.matchAll && !flags.includes('g'))
      flags += 'g'
    if (!c.matchAll)
      flags = flags.replaceAll('g', '')
    try {
      return name.replace(new RegExp(c.find, flags), c.replace)
    }
    catch {
      return name
    }
  }
  if (c.usePosition) {
    const start = c.fromEnd
      ? Math.max(0, name.length - c.positionStart - c.positionCount)
      : c.positionStart
    const end = start + c.positionCount
    return name.slice(0, start) + c.replace + name.slice(end)
  }
  if (c.matchAll) {
    const flags = c.caseSensitive ? 'g' : 'gi'
    return name.replace(new RegExp(escapeRegex(c.find), flags), c.replace)
  }
  if (c.caseSensitive) {
    const idx = name.indexOf(c.find)
    if (idx === -1)
      return name
    return name.slice(0, idx) + c.replace + name.slice(idx + c.find.length)
  }
  const idx = name.toLowerCase().indexOf(c.find.toLowerCase())
  if (idx === -1)
    return name
  return name.slice(0, idx) + c.replace + name.slice(idx + c.find.length)
}

function sequenceValue(
  c: SequenceConfig,
  index: number,
  context: RuleContext,
  precomputedSeqValue?: string,
): string {
  if (precomputedSeqValue !== undefined)
    return precomputedSeqValue
  const numValue = c.start + index * c.step
  switch (c.seqType) {
    case 'numeric':
      return String(numValue).padStart(sequencePadding(c, context.totalFiles ?? context.index + 1), '0')
    case 'alpha':
      return toAlpha(numValue)
    case 'roman':
      return toRoman(numValue)
    default:
      return String(numValue)
  }
}

function applyTemplate(
  name: string,
  c: TemplateConfig,
  index: number,
  context: RuleContext,
  precomputedSeqValue?: string,
): string {
  if (!c.template)
    return name
  if (!c.template.includes('{n}'))
    return resolveVariables(c.template, context)
  const seqValue = sequenceValue(c.sequence, index, context, precomputedSeqValue)
  return resolveVariables(c.template.replaceAll('{n}', seqValue), context)
}

function toWords(str: string): string[] {
  return (
    str
    // Split camelCase and PascalCase boundaries: myFileName -> my File Name
      .replace(/([a-z])([A-Z])/g, '$1 $2')
    // Split consecutive capitals followed by lowercase: XMLParser -> XML Parser
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    // Replace underscores and dashes with spaces
      .replace(/[_-]+/g, ' ')
      .trim()
    // Split on spaces
      .split(/\s+/)
    // Drop empty parts
      .filter(Boolean)
  )
}

function applyCaseStyle(name: string, c: CaseStyleConfig): string {
  let result = name
  // style first
  switch (c.style) {
    case 'spaceToDash':
      result = result.replace(/ /g, '-')
      break
    case 'spaceToUnderscore':
      result = result.replace(/ /g, '_')
      break
    case 'dashToSpace':
      result = result.replace(/-/g, ' ')
      break
    case 'underscoreToSpace':
      result = result.replace(/_/g, ' ')
      break
  }
  // case
  switch (c.mode) {
    case 'uppercase':
      return result.toUpperCase()
    case 'lowercase':
      return result.toLowerCase()
    case 'titlecase':
      return result.replace(/\b\w/g, ch => ch.toUpperCase())
    case 'sentencecase':
      return result.charAt(0).toUpperCase() + result.slice(1).toLowerCase()
    case 'camelCase': {
      const words = toWords(result)
      return words
        .map((w, i) =>
          i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(),
        )
        .join('')
    }
    case 'PascalCase': {
      const words = toWords(result)
      return words.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join('')
    }
    case 'kebab-case': {
      const words = toWords(result)
      return words.map(w => w.toLowerCase()).join('-')
    }
    case 'snake_case': {
      const words = toWords(result)
      return words.map(w => w.toLowerCase()).join('_')
    }
    default:
      return result
  }
}

export function createCustomJsOptions(
  name: string,
  ext: string,
  index: number,
  context: RuleContext,
): CustomJsOptions {
  const normalizedExt = ext.startsWith('.') ? ext.slice(1) : ext
  const suffix = normalizedExt ? `.${normalizedExt}` : ''
  return {
    name,
    ext: normalizedExt,
    fullName: suffix && !name.endsWith(suffix) ? `${name}${suffix}` : name,
    index,
    size: context.size ?? undefined,
    modifiedTime: context.modified,
  }
}

function applyRemoveCleanup(name: string, c: RemoveCleanupConfig): string {
  switch (c.mode) {
    case 'chars': {
      const count = Math.min(c.count, name.length)
      if (count <= 0)
        return name
      return c.direction === 'start' ? name.slice(count) : name.slice(0, name.length - count)
    }
    case 'range': {
      const start = Math.max(0, Math.min(c.rangeStart, name.length))
      const end = Math.max(start, Math.min(c.rangeEnd, name.length))
      return name.slice(0, start) + name.slice(end)
    }
    case 'cleanup': {
      let result = name
      if (c.removeDigits)
        result = result.replace(/\d/g, '')
      if (c.removeEnglish)
        result = result.replace(/[a-z]/gi, '')
      if (c.removeChinese)
        result = result.replace(/[\u4E00-\u9FFF]/g, '')
      if (c.removeSpaces)
        result = result.replace(/\s+/g, '')
      if (c.removeSymbols)
        result = result.replace(/[^\w\s\u4E00-\u9FFF]/g, '')
      return result
    }
    default:
      return name
  }
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function hasInvalidFileNameChars(name: string) {
  if (/[<>:"/\\|?*]/.test(name))
    return true
  for (const ch of name) {
    if (ch.charCodeAt(0) <= 31)
      return true
  }
  return false
}

function getFilenameError(fullName: string, editablePart = fullName): string | undefined {
  const trimmedFullName = fullName.trim()
  const trimmedEditablePart = editablePart.trim()
  if (trimmedFullName === '' || trimmedFullName === '.' || trimmedEditablePart === '') {
    return 'empty'
  }
  if (hasInvalidFileNameChars(fullName)) {
    return 'illegal'
  }
  return undefined
}

export function applyRule(
  rule: RenameRule,
  name: string,
  _ext: string,
  index: number,
  context: RuleContext,
  precomputedSeqValue?: string,
): string {
  if (!rule.enabled)
    return name
  const { ruleConfig } = rule
  switch (ruleConfig.type) {
    case 'findReplace':
      return applyFindReplace(name, ruleConfig.config)
    case 'template':
      return applyTemplate(name, ruleConfig.config, index, context, precomputedSeqValue)
    case 'caseStyle':
      return applyCaseStyle(name, ruleConfig.config)
    case 'customJs':
      return name
    case 'removeCleanup':
      return applyRemoveCleanup(name, ruleConfig.config)
    default:
      return name
  }
}

export function computePreview(
  files: FileEntry[],
  rules: RenameRule[],
  extensionScope: ExtensionScope,
): PreviewResult[] {
  const selectedFiles = files.filter(f => f.selected)
  const results: PreviewResult[] = []
  // Conflict key = directory + newName, so files in different directories don't conflict
  const nameCount = new Map<string, number>()
  const conflictKeys: string[] = []

  const getDirKey = (file: FileEntry) => {
    if (!file.relativePath)
      return ''
    const lastSlash = file.relativePath.lastIndexOf('/')
    return lastSlash > 0 ? file.relativePath.slice(0, lastSlash) : ''
  }

  // Pre-compute numbering data for template rules that use {n}.
  const sequenceDataMap = new Map<string, Map<string, SequenceFileData>>()
  for (const rule of rules) {
    if (!rule.enabled || rule.ruleConfig.type !== 'template' || !rule.ruleConfig.config.template.includes('{n}'))
      continue
    sequenceDataMap.set(rule.id, computeSequenceData(selectedFiles, rule.ruleConfig.config.sequence, getDirKey))
  }

  // Helper to apply a single rule with sequence-aware index lookup
  const applyRuleWithSeqData = (
    rule: RenameRule,
    currentName: string,
    ext: string,
    globalIndex: number,
    fileId: string,
    context: RuleContext,
  ): string => {
    let effectiveIndex = globalIndex
    let precomputedSeqValue: string | undefined
    if (rule.ruleConfig.type === 'template' && sequenceDataMap.has(rule.id)) {
      const fileData = sequenceDataMap.get(rule.id)!.get(fileId)
      if (fileData) {
        effectiveIndex = fileData.index
        precomputedSeqValue = fileData.seqValue
      }
    }
    return applyRule(rule, currentName, ext, effectiveIndex, context, precomputedSeqValue)
  }

  for (let i = 0; i < selectedFiles.length; i++) {
    const file = selectedFiles[i]
    let name: string
    let ext: string

    const folderName = file.relativePath ? file.relativePath.split('/').slice(-2, -1)[0] || '' : ''

    const context: RuleContext = {
      index: i,
      totalFiles: selectedFiles.length,
      ext: file.extension,
      originalName: file.baseName,
      currentName: file.baseName,
      folderName,
      relativePath: file.relativePath,
      size: file.size,
      modified: file.modified,
    }

    switch (extensionScope) {
      case 'name':
        name = file.baseName
        ext = file.extension
        for (const rule of rules) {
          name = applyRuleWithSeqData(rule, name, ext, i, file.id, context)
          context.currentName = name
        }
        // A template may include {ext}; do not append the extension twice.
        if (ext && name.endsWith(ext)) {
          ext = ''
        }
        break
      case 'extension':
        name = file.baseName
        ext = file.extension.startsWith('.') ? file.extension.slice(1) : file.extension
        for (const rule of rules) {
          ext = applyRuleWithSeqData(rule, ext, '', i, file.id, context)
          context.currentName = ext
        }
        ext = ext ? `.${ext}` : ''
        break
      case 'full':
        name = file.name
        ext = ''
        for (const rule of rules) {
          name = applyRuleWithSeqData(rule, name, file.extension, i, file.id, context)
          context.currentName = name
        }
        break
      default:
        name = file.baseName
        ext = file.extension
    }

    const fullName = extensionScope === 'full' ? name : name + ext
    const validationTarget = extensionScope === 'name' ? name : fullName
    const conflictKey = `${getDirKey(file)}/${fullName}`
    nameCount.set(conflictKey, (nameCount.get(conflictKey) || 0) + 1)
    conflictKeys.push(conflictKey)
    const dirPath = getDirKey(file)
    const error = getFilenameError(fullName, validationTarget)
    results.push({
      fileId: file.id,
      original: file.name,
      newName: fullName,
      hasChange: fullName !== file.name,
      conflict: !!error,
      error,
      dirPath: dirPath || undefined,
    })
  }

  // Mark conflicts (only within the same directory)
  for (let i = 0; i < results.length; i++) {
    const r = results[i]
    if ((nameCount.get(conflictKeys[i]) || 0) > 1) {
      r.conflict = true
    }
    const error = getFilenameError(r.newName)
    if (error) {
      r.conflict = true
      r.error = error
    }
  }

  // Add non-selected files
  for (const file of files) {
    if (!file.selected) {
      const dirPath = getDirKey(file)
      results.push({
        fileId: file.id,
        original: file.name,
        newName: file.name,
        hasChange: false,
        conflict: false,
        dirPath: dirPath || undefined,
      })
    }
  }

  return results
}

export function autoFixConflicts(
  results: PreviewResult[],
  extensionScope: ExtensionScope,
): PreviewResult[] {
  const conflictGroups = new Map<string, PreviewResult[]>()

  for (const result of results) {
    if (!result.conflict || result.error)
      continue

    const getDirPath = () => result.dirPath || ''
    const key = `${getDirPath()}/${result.newName}`

    if (!conflictGroups.has(key)) {
      conflictGroups.set(key, [])
    }
    conflictGroups.get(key)!.push(result)
  }

  const nameCount = new Map<string, number>()
  const fixedResults = results.map(r => ({ ...r }))

  for (const group of conflictGroups.values()) {
    if (group.length <= 1)
      continue

    for (let i = 0; i < group.length; i++) {
      const result = group[i]
      const fixed = fixedResults.find(fr => fr.fileId === result.fileId)
      if (!fixed)
        continue

      let baseName = fixed.newName
      let ext = ''

      if (extensionScope !== 'full') {
        const lastDot = baseName.lastIndexOf('.')
        if (lastDot > 0) {
          ext = baseName.slice(lastDot)
          baseName = baseName.slice(0, lastDot)
        }
      }

      const suffix = ` (${i + 1})`
      fixed.newName = baseName + suffix + ext
      fixed.hasChange = fixed.newName !== fixed.original
      fixed.conflict = false
      fixed.error = undefined
    }
  }

  const getDirKey = (result: PreviewResult) => result.dirPath || ''

  for (const result of fixedResults) {
    if (!result.hasChange)
      continue
    const conflictKey = `${getDirKey(result)}/${result.newName}`
    nameCount.set(conflictKey, (nameCount.get(conflictKey) || 0) + 1)
  }

  const conflictKeys: string[] = []
  for (const result of fixedResults) {
    if (!result.hasChange) {
      conflictKeys.push('')
      continue
    }
    const conflictKey = `${getDirKey(result)}/${result.newName}`
    conflictKeys.push(conflictKey)
  }

  for (let i = 0; i < fixedResults.length; i++) {
    const r = fixedResults[i]
    if (!r.hasChange)
      continue

    if ((nameCount.get(conflictKeys[i]) || 0) > 1) {
      r.conflict = true
    }
    else {
      const error = getFilenameError(r.newName)
      if (error) {
        r.conflict = true
        r.error = error
      }
      else {
        r.conflict = false
      }
    }
  }

  return fixedResults
}

export function hasEnabledCustomJsRule(rules: RenameRule[]): boolean {
  return rules.some(rule => rule.enabled && rule.ruleConfig.type === 'customJs')
}
