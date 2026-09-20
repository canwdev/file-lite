<script lang="ts" setup>
import { SHELL_SHORTCUT_SCOPE, useShortcutRegistry } from '@/hooks/use-shortcut'
import { appMetaByName } from '@/views/Apps/apps'
import { appsStoreState } from '@/views/Apps/apps-store'

const filter = ref('')
const registered = useShortcutRegistry()

const rows = computed(() => {
  const needle = filter.value.trim().toLowerCase()
  if (!needle)
    return registered.value
  return registered.value.filter((item) => {
    const hay = `${item.scope} ${item.combos.join(' ')} ${item.description}`.toLowerCase()
    return hay.includes(needle)
  })
})

const groups = computed(() => {
  const map = new Map<string, typeof registered.value>()
  for (const item of rows.value) {
    const list = map.get(item.scope) ?? []
    list.push(item)
    map.set(item.scope, list)
  }
  return [...map.entries()].map(([scope, items]) => ({ scope, items }))
})

function shortId(id: string) {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id
}

function scopeLabel(scope: string) {
  if (scope === SHELL_SHORTCUT_SCOPE)
    return 'Shell'
  if (scope === 'fileManager')
    return 'Explorer'
  if (scope === 'fileSelector')
    return 'File picker'
  if (scope.startsWith('fileManager:'))
    return `Explorer pane`
  if (scope.startsWith('app:')) {
    const winId = scope.slice(4)
    const win = appsStoreState.windows.find(w => w.id === winId)
    if (win) {
      const meta = appMetaByName[win.appName]
      const title = win.appTitle?.trim() || meta?.name || win.appName
      return `App: ${title}`
    }
    return `App (${shortId(winId)})`
  }
  return scope
}
</script>

<template>
  <div class="shortcuts-wrap">
    <div class="shortcuts-toolbar vgo-panel vgo-panel--flat">
      <input
        v-model="filter"
        class="vgo-input"
        type="search"
        placeholder="Filter by key, scope or description…"
      >
      <span class="shortcuts-count">
        {{ rows.length }} shortcut{{ rows.length === 1 ? '' : 's' }}
      </span>
    </div>

    <div v-if="!groups.length" class="vgo-empty shortcuts-empty">
      <i-mdi-keyboard-outline class="vgo-empty__icon" />
      <div class="vgo-empty__title">
        No shortcuts match
      </div>
      <div class="vgo-empty__desc">
        Clear the filter, or open an explorer pane so its bindings register.
      </div>
    </div>

    <div v-else class="shortcuts-body">
      <section v-for="group in groups" :key="group.scope" class="shortcuts-group">
        <header class="shortcuts-group__title">
          {{ scopeLabel(group.scope) }}
        </header>
        <div
          v-for="(item, index) in group.items"
          :key="`${item.scope}:${item.combos.join('|')}:${index}`"
          class="vgo-list-item shortcuts-row"
          :class="{ 'is-disabled': item.disabled }"
        >
          <div class="shortcuts-row__keys">
            <kbd
              v-for="combo in item.combos"
              :key="combo"
              class="shortcuts-kbd vgo-u-font-code"
            >{{ combo }}</kbd>
          </div>
          <div class="shortcuts-row__desc vgo-u-text-overflow">
            {{ item.description || '—' }}
          </div>
          <span v-if="item.allowInInput" class="vgo-badge">in input</span>
          <span v-if="item.disabled" class="vgo-badge">off</span>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped lang="scss">
.shortcuts-wrap {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.shortcuts-toolbar {
  display: flex;
  align-items: center;
  gap: var(--vgo-space-2);
  padding: var(--vgo-space-2);
  border-bottom: 1px solid var(--vgo-border);
  flex-shrink: 0;

  .vgo-input {
    flex: 1;
    min-width: 0;
  }
}

.shortcuts-count {
  flex-shrink: 0;
  font-size: var(--vgo-font-sm);
  color: var(--vgo-text-secondary);
  white-space: nowrap;
}

.shortcuts-empty {
  flex: 1;
}

.shortcuts-body {
  flex: 1;
  overflow: auto;
  padding: var(--vgo-space-2);
  display: flex;
  flex-direction: column;
  gap: var(--vgo-space-3);
}

.shortcuts-group__title {
  display: flex;
  align-items: baseline;
  gap: var(--vgo-space-2);
  padding: var(--vgo-space-1) var(--vgo-space-2);
  font-size: var(--vgo-font-sm);
  font-weight: 500;
  color: var(--vgo-text-secondary);
}

.shortcuts-group__scope {
  font-weight: 400;
  opacity: 0.7;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.shortcuts-row {
  gap: var(--vgo-space-2);
}

.shortcuts-row__keys {
  display: flex;
  flex-wrap: wrap;
  gap: var(--vgo-space-1);
  flex-shrink: 0;
  min-width: 7rem;
}

.shortcuts-row__desc {
  flex: 1;
  min-width: 0;
}

.shortcuts-kbd {
  display: inline-flex;
  align-items: center;
  height: var(--vgo-control-sm);
  padding: 0 var(--vgo-space-2);
  font-size: var(--vgo-font-sm);
  line-height: 1;
  color: var(--vgo-text);
  background-color: var(--vgo-surface-raised);
  border: 1px solid var(--vgo-border);
  border-radius: var(--vgo-radius);
}
</style>
