<script setup lang="ts">
import type { UpdateChannel, UpdateInfo } from '@/api/server'
import type { SharedWsServerMessage, UpdateStatus, UpdateWsMessage } from '@/types/server'
import { checkUpdate, getUpdateStatus, installGitHubUpdate } from '@/api/server'
import { subscribeSharedWsMessage } from '@/api/shared-ws'
import { settingsStore } from '@/store'
import { serverCapabilities } from '@/store/capabilities'

const RESTART_INITIAL_DELAY_MS = 1200
const RESTART_POLL_INTERVAL_MS = 500
const RESTART_TIMEOUT_MS = 30_000

const selfUpdate = computed(() => serverCapabilities.value.selfUpdate)
const channel = computed<UpdateChannel>(() =>
  settingsStore.value.updateChannel === 'preview' ? 'preview' : 'stable',
)

const checking = ref(false)
const installing = ref(false)
const info = ref<UpdateInfo | null>(null)
const status = ref<UpdateStatus>({ active: false })

const busy = computed(() => installing.value || status.value.active)
const showProgress = computed(() => busy.value || status.value.phase === 'done' || Boolean(status.value.error))

const primaryLabel = computed(() => {
  if (busy.value)
    return `${$t('file_lite_i18n.updating')}${ELLIPSIS}`
  if (checking.value)
    return `${$t('file_lite_i18n.checking')}${ELLIPSIS}`
  if (info.value?.available)
    return $t('file_lite_i18n.update_to_0', [info.value.latest])
  return $t('file_lite_i18n.check_for_updates')
})

const checkHint = computed(() => {
  if (!info.value || info.value.available)
    return ''
  return $t('file_lite_i18n.on_latest_version')
})

const releaseNotesURL = computed(() => info.value?.available ? info.value.notesUrl : '')

const progressPercent = computed(() => {
  const snapshot = status.value
  if (snapshot.phase && snapshot.phase !== 'download')
    return 100
  if (typeof snapshot.percent === 'number')
    return Math.min(100, Math.max(0, snapshot.percent))
  if (snapshot.total && snapshot.total > 0)
    return Math.min(100, Math.max(0, Math.round((snapshot.received ?? 0) * 100 / snapshot.total)))
  return 0
})

const progressLabel = computed(() => {
  const snapshot = status.value
  if (snapshot.error)
    return $t('file_lite_i18n.update_failed_0', [snapshot.error])
  switch (snapshot.phase) {
    case 'download':
      return snapshot.total && snapshot.total > 0
        ? `${$t('file_lite_i18n.downloading')} ${progressPercent.value}%`
        : `${$t('file_lite_i18n.downloading')}${ELLIPSIS}`
    case 'verify':
    case 'install':
      return `${$t('file_lite_i18n.installing')}${ELLIPSIS}`
    case 'extract':
      return `${$t('file_lite_i18n.extracting')}${ELLIPSIS}`
    case 'done':
      return `${$t('file_lite_i18n.updated_restarting')}${ELLIPSIS}`
    default:
      return ''
  }
})

let checkSequence = 0

async function checkForUpdates() {
  if (!selfUpdate.value || busy.value)
    return
  const token = ++checkSequence
  checking.value = true
  info.value = null
  status.value = { active: false }
  try {
    const result = await checkUpdate(channel.value)
    if (token === checkSequence)
      info.value = result
  }
  catch {
    // The service interceptor already toasted the reason.
  }
  finally {
    if (token === checkSequence)
      checking.value = false
  }
}

async function startUpdate() {
  const release = info.value
  if (!release?.available || busy.value)
    return

  status.value = { active: true, phase: 'download', to: release.latest }
  installing.value = true
  try {
    await installGitHubUpdate(release.tag)
    window.$message?.success(`${$t('file_lite_i18n.updated_restarting')}${ELLIPSIS}`)
    void waitForRestart()
  }
  catch {
    // The backend also broadcasts the reason, which updates the progress label.
    installing.value = false
    if (status.value.active && !status.value.error)
      status.value = { active: false }
  }
}

function onPrimaryClick() {
  if (info.value?.available)
    void startUpdate()
  else
    void checkForUpdates()
}

/**
 * The backend answers before it restarts, and the old process can keep serving
 * for a moment. Wait past the restart delay, then poll until the new process
 * answers and reload into it.
 */
async function waitForRestart() {
  await new Promise(resolve => setTimeout(resolve, RESTART_INITIAL_DELAY_MS))
  const deadline = Date.now() + RESTART_TIMEOUT_MS
  while (Date.now() < deadline) {
    try {
      const response = await fetch('/api/health', { cache: 'no-store' })
      if (response.ok) {
        window.location.reload()
        return
      }
    }
    catch {
      // Still restarting.
    }
    await new Promise(resolve => setTimeout(resolve, RESTART_POLL_INTERVAL_MS))
  }
  window.location.reload()
}

function isUpdateMessage(message: SharedWsServerMessage): message is UpdateWsMessage {
  return message.scope === 'update' && 'active' in message
}

let stopListening: (() => void) | null = null

/** The channel row is an ordinary settings row, so a change there is just a store change. */
watch(channel, () => {
  info.value = null
  if (selfUpdate.value && !busy.value)
    void checkForUpdates()
})

onMounted(async () => {
  stopListening = subscribeSharedWsMessage((message) => {
    if (isUpdateMessage(message))
      status.value = message
  })

  if (!selfUpdate.value)
    return
  try {
    const snapshot = await getUpdateStatus()
    // A stale `done` / `error` from before this process restarted is not useful;
    // only an update that is still running needs to be shown on open.
    if (snapshot.active)
      status.value = snapshot
  }
  catch {
    // The endpoints are optional; a failure here must not block the version line.
  }
  if (!busy.value)
    void checkForUpdates()
})

onUnmounted(() => {
  stopListening?.()
  stopListening = null
})
</script>

<template>
  <div v-if="selfUpdate" class="update-checker">
    <div class="update-checker__actions">
      <a
        v-if="releaseNotesURL"
        class="update-checker__notes"
        :href="releaseNotesURL"
        target="_blank"
        rel="noopener noreferrer"
      >{{ $t('file_lite_i18n.release_notes') }}</a>
      <button
        type="button"
        class="vgo-button vgo-button--primary"
        :disabled="busy || checking"
        @click="onPrimaryClick"
      >
        {{ primaryLabel }}
      </button>
    </div>

    <div v-if="checkHint" class="update-checker__hint">
      {{ checkHint }}
    </div>

    <div v-if="showProgress" class="update-checker__progress">
      <div
        class="vgo-progress"
        :class="{
          'vgo-progress--success': status.phase === 'done' && !status.error,
          'vgo-progress--danger': Boolean(status.error),
        }"
      >
        <div class="vgo-progress__value" :style="{ width: `${progressPercent}%` }" />
      </div>
      <div class="update-checker__progress-label" :class="{ 'is-error': Boolean(status.error) }">
        {{ progressLabel }}
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.update-checker {
  display: flex;
  flex-direction: column;
  gap: var(--vgo-space-1);
  align-items: flex-end;
}

.update-checker__actions {
  display: flex;
  gap: var(--vgo-space-2);
  align-items: center;
}

.update-checker__notes {
  font-size: var(--vgo-font-sm);
  color: var(--vgo-primary);
  white-space: nowrap;
  text-decoration: none;
}

.update-checker__hint {
  font-size: var(--vgo-font-sm);
  color: var(--vgo-text-secondary);
  text-align: right;
}

.update-checker__progress {
  display: flex;
  flex-direction: column;
  gap: var(--vgo-space-1);
  width: 220px;
  padding-block: var(--vgo-space-1);
}

.update-checker__progress-label {
  font-size: var(--vgo-font-sm);
  color: var(--vgo-text-secondary);
  text-align: right;
}

.update-checker__progress-label.is-error {
  color: var(--vgo-danger);
}
</style>
