<script lang="ts" setup>
import type { DiffSegment } from './engine/diff'
import type { PreviewResult, RenameRule, RuleType } from './engine/types'
import { charDiff } from './engine/diff'
import { useBatchRename } from './use-batch-rename'

interface RuleLabel {
  type: RuleType
  labelKey: string
}

const TEMPLATE_TOKENS = [
  '{n}',
  '{name}',
  '{ext}',
  '{date}',
  '{date:HHmmss}',
  '{timestamp}',
]

interface TemplatePreset {
  id: string
  template: string
}

const TEMPLATE_PRESETS: TemplatePreset[] = [
  { id: 'numbered', template: '{n}. {name}' },
  { id: 'date', template: '{date}_{name}' },
  { id: 'datetime-prefix', template: '{date:YYYYMMDD_HHmmss}_{name}' },
  { id: 'datetime-suffix', template: '{name}_{date:YYYYMMDD_HHmmss}' },
]

const ADDABLE_RULE_TYPES: RuleLabel[] = [
  { type: 'findReplace', labelKey: 'file_lite_i18n.batch_rename_rule_find_replace' },
  { type: 'template', labelKey: 'file_lite_i18n.batch_rename_rule_template' },
  { type: 'caseStyle', labelKey: 'file_lite_i18n.batch_rename_rule_case_style' },
  { type: 'removeCleanup', labelKey: 'file_lite_i18n.batch_rename_rule_remove_cleanup' },
]

const ruleLabels: Record<RuleType, string> = {
  findReplace: 'file_lite_i18n.batch_rename_rule_find_replace',
  template: 'file_lite_i18n.batch_rename_rule_template',
  caseStyle: 'file_lite_i18n.batch_rename_rule_case_style',
  customJs: 'file_lite_i18n.batch_rename_rule_custom_js',
  removeCleanup: 'file_lite_i18n.batch_rename_rule_remove_cleanup',
}

const {
  files,
  rules,
  extensionScope,
  isBusy,
  notice,
  executionLog,
  undoStack,
  redoStack,
  newRuleType,
  exportFormat,
  displayPreview,
  displayChanged,
  displayConflicts,
  selectedCount,
  importEntries,
  clearFiles,
  toggleFile,
  toggleAll,
  addRule,
  removeRule,
  moveRule,
  autoFix,
  execute,
  undo,
  redo,
  exportPlan,
} = useBatchRename()

const templatePresetValues = reactive<Record<string, string>>({})

function configOf(rule: RenameRule): any {
  return rule.ruleConfig.config
}

function applyTemplatePreset(rule: RenameRule, event: Event) {
  const select = event.target as HTMLSelectElement
  const preset = TEMPLATE_PRESETS.find(item => item.id === select.value)
  if (preset)
    configOf(rule).template = preset.template
  templatePresetValues[rule.id] = ''
}

function diffSegments(row: PreviewResult): DiffSegment[] {
  return row.hasChange ? charDiff(row.original, row.newName) : []
}

/**
 * Insert a template token into the focused template input. When no template
 * input is focused, append it to the input that owns the hint and focus it.
 * If the caret is inside an existing {token}, insert after that token instead
 * of nesting one token inside another.
 */
function insertTemplate(token: string, fallbackId: string) {
  const active = document.activeElement
  const activeInput = active instanceof HTMLInputElement && active.dataset.templateInput === 'true'
    ? active
    : null
  const fallback = document.getElementById(fallbackId)
  const input = activeInput ?? (fallback instanceof HTMLInputElement ? fallback : null)
  if (!input)
    return

  const value = input.value
  let start = activeInput ? (input.selectionStart ?? value.length) : value.length
  let end = activeInput ? (input.selectionEnd ?? start) : start
  if (start === end) {
    const open = value.lastIndexOf('{', start - 1)
    const close = value.lastIndexOf('}', start - 1)
    if (open > close) {
      const nextClose = value.indexOf('}', start)
      // The caret is inside a placeholder: replace that whole placeholder.
      if (nextClose !== -1) {
        start = open
        end = nextClose + 1
      }
    }
  }

  input.value = value.slice(0, start) + token + value.slice(end)
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.focus()
  const caret = start + token.length
  input.setSelectionRange(caret, caret)
}

function isAllSelected() {
  return files.value.length > 0 && selectedCount.value === files.value.length
}
</script>

<template>
  <div class="batch-rename">
    <header class="batch-rename__header">
      <div>
        <h1>{{ $t('file_lite_i18n.batch_rename_title') }}</h1>
      </div>
      <div class="batch-rename__header-actions">
        <button class="vgo-button" :disabled="isBusy" @click="importEntries">
          {{ $t('file_lite_i18n.batch_rename_import_files') }}
        </button>
        <button class="vgo-button" :disabled="isBusy || !files.length" @click="clearFiles">
          {{ $t('file_lite_i18n.batch_rename_clear') }}
        </button>
      </div>
    </header>

    <div v-if="notice" class="batch-rename__notice">
      {{ notice }}
    </div>

    <div class="batch-rename__body">
      <section class="batch-rename__panel batch-rename__files">
        <div class="batch-rename__panel-head">
          <strong>{{ $t('file_lite_i18n.batch_rename_files') }} <span class="muted">({{ selectedCount }}/{{ files.length }})</span></strong>
          <label v-if="files.length" class="batch-rename__check">
            <input type="checkbox" :checked="isAllSelected()" @change="toggleAll(!isAllSelected())">
            {{ $t('file_lite_i18n.batch_rename_all') }}
          </label>
        </div>
        <div v-if="!files.length" class="batch-rename__empty">
          {{ $t('file_lite_i18n.batch_rename_empty_files') }}
        </div>
        <ul v-else class="batch-rename__list">
          <li v-for="file in files" :key="file.id">
            <label>
              <input type="checkbox" :checked="file.selected" @change="toggleFile(file.id)">
              <i-mdi-folder v-if="file.isDirectory" class="vgo-u-icon-sm batch-rename__file-icon" />
              <span class="batch-rename__file-name" :title="file.path">{{ file.name }}</span>
            </label>
          </li>
        </ul>
      </section>

      <section class="batch-rename__panel batch-rename__rules">
        <div class="batch-rename__panel-head">
          <strong>{{ $t('file_lite_i18n.batch_rename_rules') }}</strong>
        </div>
        <div class="batch-rename__rule-add">
          <span class="batch-rename__rule-add-plus" aria-hidden="true">+</span>
          <select v-model="newRuleType" class="vgo-input" @change="addRule">
            <option value="" disabled>
              {{ $t('file_lite_i18n.batch_rename_add_rule') }}
            </option>
            <option v-for="item in ADDABLE_RULE_TYPES" :key="item.type" :value="item.type">
              {{ $t(item.labelKey) }}
            </option>
          </select>
        </div>
        <div class="batch-rename__scope">
          <span>{{ $t('file_lite_i18n.batch_rename_apply_to') }}</span>
          <select v-model="extensionScope" class="vgo-input">
            <option value="name">
              {{ $t('file_lite_i18n.batch_rename_scope_name') }}
            </option>
            <option value="extension">
              {{ $t('file_lite_i18n.batch_rename_scope_extension') }}
            </option>
            <option value="full">
              {{ $t('file_lite_i18n.batch_rename_scope_full') }}
            </option>
          </select>
        </div>
        <div v-if="!rules.length" class="batch-rename__empty">
          {{ $t('file_lite_i18n.batch_rename_empty_rules') }}
        </div>
        <div v-else class="batch-rename__rule-list">
          <article v-for="(rule, index) in rules" :key="rule.id" class="batch-rename__rule" :class="{ 'is-disabled': !rule.enabled }">
            <div class="batch-rename__rule-head">
              <span class="batch-rename__rule-index">{{ index + 1 }}</span>
              <strong>{{ $t(ruleLabels[rule.ruleConfig.type]) }}</strong>
              <input v-model="rule.enabled" type="checkbox" :title="$t('file_lite_i18n.batch_rename_enabled')">
              <div class="batch-rename__rule-actions">
                <button class="vgo-button vgo-button--text" :disabled="index === 0" @click="moveRule(rule.id, -1)">
                  ↑
                </button>
                <button class="vgo-button vgo-button--text" :disabled="index === rules.length - 1" @click="moveRule(rule.id, 1)">
                  ↓
                </button>
                <button class="vgo-button vgo-button--text vgo-button--danger" @click="removeRule(rule.id)">
                  ×
                </button>
              </div>
            </div>

            <div v-if="rule.ruleConfig.type === 'findReplace'" class="batch-rename__fields">
              <label>{{ $t('file_lite_i18n.batch_rename_find') }} <input v-model="configOf(rule).find" class="vgo-input" placeholder="text"></label>
              <label>{{ $t('file_lite_i18n.batch_rename_replace') }} <input v-model="configOf(rule).replace" class="vgo-input" placeholder="text"></label>
              <label class="inline"><input v-model="configOf(rule).caseSensitive" type="checkbox"> {{ $t('file_lite_i18n.batch_rename_case_sensitive') }}</label>
              <label class="inline"><input v-model="configOf(rule).useRegex" type="checkbox"> {{ $t('file_lite_i18n.batch_rename_rule_regex') }}</label>
              <label v-if="configOf(rule).useRegex">{{ $t('file_lite_i18n.batch_rename_flags') }} <input v-model="configOf(rule).regexFlags" class="vgo-input" placeholder="g"></label>
            </div>

            <div v-else-if="rule.ruleConfig.type === 'template'" class="batch-rename__fields">
              <label class="batch-rename__template-field">
                {{ $t('file_lite_i18n.batch_rename_presets') }}
                <select :value="templatePresetValues[rule.id] ?? ''" class="vgo-input" @change="applyTemplatePreset(rule, $event)">
                  <option value="" disabled>
                    {{ $t('file_lite_i18n.batch_rename_select_preset') }}
                  </option>
                  <option v-for="preset in TEMPLATE_PRESETS" :key="preset.id" :value="preset.id">
                    {{ preset.template }}
                  </option>
                </select>
              </label>
              <label class="batch-rename__template-field">{{ $t('file_lite_i18n.batch_rename_template') }} <input :id="`batch-rename-template-${rule.id}`" v-model="configOf(rule).template" data-template-input="true" class="vgo-input" placeholder="{n}. {name}"></label>
              <div class="batch-rename__template-hint">
                <span>{{ $t('file_lite_i18n.batch_rename_available') }}:</span>
                <button
                  v-for="token in TEMPLATE_TOKENS"
                  :key="token"
                  type="button"
                  class="vgo-button vgo-button--text batch-rename__template-token"
                  :title="token === '{date:HHmmss}' ? $t('file_lite_i18n.batch_rename_date_format_hint') : token"
                  @mousedown.prevent
                  @click="insertTemplate(token, `batch-rename-template-${rule.id}`)"
                >
                  {{ token }}
                </button>
              </div>
              <div v-if="configOf(rule).template.includes('{n}')" class="batch-rename__sequence-options">
                <strong>{{ $t('file_lite_i18n.batch_rename_rule_sequence') }}</strong>
                <label>{{ $t('file_lite_i18n.batch_rename_start') }} <input v-model.number="configOf(rule).sequence.start" type="number" class="vgo-input"></label>
                <label>{{ $t('file_lite_i18n.batch_rename_step') }} <input v-model.number="configOf(rule).sequence.step" type="number" min="1" class="vgo-input"></label>
                <label class="inline"><input v-model="configOf(rule).sequence.paddingAuto" type="checkbox"> {{ $t('file_lite_i18n.batch_rename_padding_auto') }}</label>
                <label v-if="!configOf(rule).sequence.paddingAuto">{{ $t('file_lite_i18n.batch_rename_padding') }} <input v-model.number="configOf(rule).sequence.padding" type="number" min="1" class="vgo-input"></label>
              </div>
            </div>

            <div v-else-if="rule.ruleConfig.type === 'caseStyle'" class="batch-rename__fields">
              <label>{{ $t('file_lite_i18n.batch_rename_mode') }}
                <select v-model="configOf(rule).mode" class="vgo-input">
                  <option value="lowercase">lowercase</option>
                  <option value="uppercase">UPPERCASE</option>
                  <option value="titlecase">Title Case</option>
                  <option value="sentencecase">Sentence case</option>
                  <option value="camelCase">camelCase</option>
                  <option value="PascalCase">PascalCase</option>
                  <option value="kebab-case">kebab-case</option>
                  <option value="snake_case">snake_case</option>
                </select>
              </label>
            </div>

            <div v-else-if="rule.ruleConfig.type === 'removeCleanup'" class="batch-rename__fields">
              <label>{{ $t('file_lite_i18n.batch_rename_mode') }}
                <select v-model="configOf(rule).mode" class="vgo-input">
                  <option value="chars">{{ $t('file_lite_i18n.batch_rename_characters') }}</option>
                  <option value="range">{{ $t('file_lite_i18n.batch_rename_range') }}</option>
                  <option value="cleanup">{{ $t('file_lite_i18n.batch_rename_cleanup') }}</option>
                </select>
              </label>
              <template v-if="configOf(rule).mode === 'chars'">
                <label>{{ $t('file_lite_i18n.batch_rename_count') }} <input v-model.number="configOf(rule).count" type="number" min="0" class="vgo-input"></label>
                <label>{{ $t('file_lite_i18n.batch_rename_from') }}
                  <select v-model="configOf(rule).direction" class="vgo-input">
                    <option value="start">{{ $t('file_lite_i18n.batch_rename_start') }}</option>
                    <option value="end">{{ $t('file_lite_i18n.batch_rename_end') }}</option>
                  </select>
                </label>
              </template>
              <template v-else-if="configOf(rule).mode === 'range'">
                <label>{{ $t('file_lite_i18n.batch_rename_start') }} <input v-model.number="configOf(rule).rangeStart" type="number" min="0" class="vgo-input"></label>
                <label>{{ $t('file_lite_i18n.batch_rename_end') }} <input v-model.number="configOf(rule).rangeEnd" type="number" min="0" class="vgo-input"></label>
              </template>
              <template v-else>
                <label class="inline"><input v-model="configOf(rule).removeDigits" type="checkbox"> {{ $t('file_lite_i18n.batch_rename_cleanup_digits') }}</label>
                <label class="inline"><input v-model="configOf(rule).removeSymbols" type="checkbox"> {{ $t('file_lite_i18n.batch_rename_cleanup_symbols') }}</label>
                <label class="inline"><input v-model="configOf(rule).removeSpaces" type="checkbox"> {{ $t('file_lite_i18n.batch_rename_cleanup_spaces') }}</label>
              </template>
            </div>
          </article>
        </div>
      </section>

      <section class="batch-rename__panel batch-rename__preview">
        <div class="batch-rename__panel-head">
          <strong>{{ $t('file_lite_i18n.batch_rename_preview') }} <span class="muted">({{ $t('file_lite_i18n.batch_rename_changes', [displayChanged.length]) }})</span></strong>
          <button v-if="displayConflicts.length" class="vgo-button vgo-button--text" @click="autoFix">
            {{ $t('file_lite_i18n.batch_rename_auto_fix') }}
          </button>
        </div>
        <div v-if="!displayPreview.length" class="batch-rename__empty">
          {{ $t('file_lite_i18n.batch_rename_empty_preview') }}
        </div>
        <div v-else class="batch-rename__preview-list">
          <div v-for="row in displayPreview" :key="row.fileId" class="batch-rename__preview-row" :class="{ conflict: row.conflict }">
            <template v-if="row.hasChange">
              <span class="batch-rename__preview-original" :title="row.original">
                <template v-for="(segment, index) in diffSegments(row)" :key="`old-${index}`">
                  <span v-if="segment.type !== 'added'" :class="`batch-rename__diff-${segment.type}`">{{ segment.text }}</span>
                </template>
              </span>
              <span class="batch-rename__preview-arrow">→</span>
              <span class="batch-rename__preview-new" :title="row.newName">
                <template v-for="(segment, index) in diffSegments(row)" :key="`new-${index}`">
                  <span v-if="segment.type !== 'removed'" :class="`batch-rename__diff-${segment.type}`">{{ segment.text }}</span>
                </template>
              </span>
            </template>
            <template v-else>
              <span class="batch-rename__preview-original" :title="row.original">{{ row.original }}</span>
              <span class="batch-rename__preview-arrow">→</span>
              <span class="batch-rename__preview-new" :title="row.newName">{{ row.newName }}</span>
            </template>
            <span v-if="row.conflict" class="batch-rename__badge">{{ row.error || $t('file_lite_i18n.batch_rename_conflict') }}</span>
          </div>
        </div>
        <div v-if="executionLog.length" class="batch-rename__log">
          <div v-for="(item, index) in executionLog" :key="`${item.fileId}-${index}`" :class="item.status">
            {{ item.status }}: {{ item.fromName }} → {{ item.toName }}
            <span v-if="item.reason">({{ item.reason }})</span>
          </div>
        </div>
      </section>
    </div>

    <footer class="batch-rename__footer">
      <div class="batch-rename__export">
        <select v-model="exportFormat" class="vgo-input">
          <option value="csv">
            CSV
          </option>
          <option value="json">
            JSON
          </option>
          <option value="sh">
            Bash
          </option>
          <option value="cmd">
            BAT (.cmd)
          </option>
        </select>
        <button class="vgo-button" :disabled="!displayChanged.length" @click="exportPlan">
          {{ $t('file_lite_i18n.batch_rename_export') }}
        </button>
      </div>
      <div class="batch-rename__footer-actions">
        <button class="vgo-button" :disabled="isBusy || !undoStack.length" @click="undo">
          {{ $t('file_lite_i18n.batch_rename_undo') }}
        </button>
        <button class="vgo-button" :disabled="isBusy || !redoStack.length" @click="redo">
          {{ $t('file_lite_i18n.batch_rename_redo') }}
        </button>
        <button class="vgo-button vgo-button--primary" :disabled="isBusy || !displayChanged.length || !!displayConflicts.length" @click="execute">
          {{ isBusy ? $t('file_lite_i18n.batch_rename_renaming') : $t('file_lite_i18n.rename') }}
        </button>
      </div>
    </footer>
  </div>
</template>

<style scoped>
.batch-rename {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  padding: var(--vgo-space-3);
  gap: var(--vgo-space-2);
  background: var(--vgo-surface);
  color: var(--vgo-text);
}

.batch-rename__header,
.batch-rename__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--vgo-space-3);
}

.batch-rename__header h1 {
  margin: 0;
  font-size: var(--vgo-font-lg);
}

.batch-rename__header p {
  margin: 2px 0 0;
  color: var(--vgo-text-secondary);
  font-size: var(--vgo-font-sm);
}

.batch-rename__header-actions,
.batch-rename__footer-actions,
.batch-rename__export {
  display: flex;
  align-items: center;
  gap: var(--vgo-space-2);
}

.batch-rename__notice {
  padding: 6px 10px;
  border: 1px solid var(--vgo-warning);
  border-radius: var(--vgo-radius);
  color: var(--vgo-warning);
  background: color-mix(in srgb, var(--vgo-warning) 8%, transparent);
  font-size: var(--vgo-font-sm);
}

.batch-rename__body {
  display: grid;
  grid-template-columns: minmax(220px, 0.9fr) minmax(260px, 1fr) minmax(320px, 1.5fr);
  gap: var(--vgo-space-2);
  flex: 1;
  min-height: 0;
}

.batch-rename__panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border: 1px solid var(--vgo-border);
  border-radius: var(--vgo-radius);
  background: var(--vgo-surface);
  overflow: hidden;
}

.batch-rename__panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--vgo-space-2);
  padding: 8px 10px;
  border-bottom: 1px solid var(--vgo-border);
  font-size: var(--vgo-font-sm);
}

.muted {
  color: var(--vgo-text-secondary);
  font-weight: normal;
}

.batch-rename__list,
.batch-rename__rule-list,
.batch-rename__preview-list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  margin: 0;
  padding: 0;
  list-style: none;
}

.batch-rename__list li {
  padding: 4px 10px;
  font-size: var(--vgo-font-sm);
}

.batch-rename__list label {
  display: flex;
  align-items: center;
  gap: 8px;
}

.batch-rename__file-icon {
  flex: none;
  color: var(--vgo-text-secondary);
}

.batch-rename__file-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.batch-rename__empty {
  margin: auto;
  padding: 24px;
  max-width: 320px;
  color: var(--vgo-text-secondary);
  font-size: var(--vgo-font-sm);
  text-align: center;
}

.batch-rename__rule-add,
.batch-rename__scope {
  display: flex;
  align-items: center;
  gap: var(--vgo-space-2);
  padding: 8px 10px;
  border-bottom: 1px solid var(--vgo-border);
}

.batch-rename__rule-add-plus {
  color: var(--vgo-primary);
  font-weight: 700;
}

.batch-rename__rule-add .vgo-input {
  flex: 1;
}

.batch-rename__scope {
  font-size: var(--vgo-font-sm);
  color: var(--vgo-text-secondary);
}

.batch-rename__rule {
  padding: 8px 10px;
  border-bottom: 1px solid var(--vgo-border);
}

.batch-rename__rule.is-disabled {
  opacity: 0.45;
  filter: grayscale(1);
}

.batch-rename__rule.is-disabled .batch-rename__rule-head strong {
  text-decoration: line-through;
}

.batch-rename__rule-head {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--vgo-font-sm);
}

.batch-rename__rule-index {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--vgo-primary);
  color: var(--vgo-on-primary);
  font-size: 10px;
}

.batch-rename__rule-actions {
  display: flex;
  gap: 2px;
  margin-left: auto;
}

.batch-rename__fields {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 6px;
  padding-top: 8px;
}

.batch-rename__fields label {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  color: var(--vgo-text-secondary);
  font-size: var(--vgo-font-sm);
}

.batch-rename__fields .vgo-input {
  width: 100%;
}

.batch-rename__template-field {
  grid-column: 1 / -1;
}

.batch-rename__sequence-options {
  display: grid;
  grid-column: 1 / -1;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: var(--vgo-space-2);
  padding: var(--vgo-space-2);
  border: 1px solid var(--vgo-border);
  border-radius: var(--vgo-radius);
  background: var(--vgo-hover);
}

.batch-rename__sequence-options > strong {
  grid-column: 1 / -1;
  color: var(--vgo-text-secondary);
  font-size: var(--vgo-font-sm);
}

.batch-rename__sequence-options label {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  color: var(--vgo-text-secondary);
  font-size: var(--vgo-font-sm);
}

.batch-rename__sequence-options label.inline {
  flex-direction: row;
  align-items: center;
}

.batch-rename__fields label.inline {
  flex-direction: row;
  align-items: center;
}

.batch-rename__template-hint {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 6px;
  grid-column: 1 / -1;
  color: var(--vgo-text-secondary);
  font-size: 11px;
}

.batch-rename .batch-rename__template-hint .batch-rename__template-token {
  min-height: 0;
  padding: 1px 4px;
  color: var(--vgo-primary);
  background-color: var(--vgo-hover);
  border: 1px solid var(--vgo-border);
  border-radius: var(--vgo-radius);
  font-family: var(--vgo-font-mono);
  font-size: 11px;
  line-height: 1.4;
}

.batch-rename .batch-rename__template-hint .batch-rename__template-token:hover {
  border-color: var(--vgo-primary);
}

.batch-rename__check {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--vgo-text-secondary);
  font-size: var(--vgo-font-sm);
}

.batch-rename__preview-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border-bottom: 1px solid var(--vgo-border);
  font-size: var(--vgo-font-sm);
}

.batch-rename__preview-row.conflict {
  background: color-mix(in srgb, var(--vgo-danger) 8%, transparent);
}

.batch-rename__preview-original,
.batch-rename__preview-new {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.batch-rename__preview-new {
  color: var(--vgo-text);
}

.batch-rename__preview-original,
.batch-rename__preview-new {
  white-space: pre-wrap;
}

.batch-rename__diff-removed {
  color: var(--vgo-danger);
  background-color: color-mix(in srgb, var(--vgo-danger) 18%, transparent);
  border-radius: var(--vgo-radius);
  text-decoration: line-through;
}

.batch-rename__diff-added {
  color: var(--vgo-success);
  background-color: color-mix(in srgb, var(--vgo-success) 18%, transparent);
  border-radius: var(--vgo-radius);
}

.batch-rename__preview-arrow {
  color: var(--vgo-text-secondary);
}

.batch-rename__badge {
  color: var(--vgo-danger);
  font-size: 11px;
}

.batch-rename__log {
  max-height: 120px;
  overflow: auto;
  padding: 6px 10px;
  border-top: 1px solid var(--vgo-border);
  font-size: 11px;
}

.batch-rename__log .failed {
  color: var(--vgo-danger);
}

.batch-rename__log .success {
  color: var(--vgo-success);
}

.batch-rename__footer {
}

@media (max-width: 900px) {
  .batch-rename__body {
    grid-template-columns: 1fr;
    overflow: auto;
  }

  .batch-rename__panel {
    min-height: 240px;
  }
}
</style>
