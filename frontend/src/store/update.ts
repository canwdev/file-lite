import type { UpdateChannel, UpdateInfo } from '@/api/server'
import type { SharedWsServerMessage, UpdateStatus, UpdateWsMessage } from '@/types/server'
import { checkUpdate, getUpdateStatus, installGitHubUpdate } from '@/api/server'
import { subscribeSharedWsMessage } from '@/api/shared-ws'
import { ensureSettingsStoreInitialized, settingsStore } from '@/store'

const AUTO_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000
const AUTO_CHECK_INITIAL_DELAY_MS = 10_000
const AUTO_CHECK_RETRY_MS = 60 * 60 * 1000
const RESTART_INITIAL_DELAY_MS = 1200
const RESTART_POLL_INTERVAL_MS = 500
const RESTART_TIMEOUT_MS = 30_000

export const updateChecking = ref(false)
export const updateInstalling = ref(false)
export const updateInfo = ref<UpdateInfo | null>(null)
export const updateStatus = ref<UpdateStatus>({ active: false })
export const updateDialogVisible = ref(false)
export const updateErrorMessage = ref('')

export const updateBusy = computed(() => updateInstalling.value || updateStatus.value.active)
export const updateChannel = computed<UpdateChannel>(() =>
  settingsStore.value.updateChannel === 'preview' ? 'preview' : 'stable',
)

let initialized = false
let autoCheckTimer: ReturnType<typeof setTimeout> | null = null
let stopListening: (() => void) | null = null
let stopWatchers: Array<() => void> = []
let restarting = false

function isUpdateMessage(message: SharedWsServerMessage): message is UpdateWsMessage {
  return message.scope === 'update' && 'active' in message
}

function clearAutoCheckTimer() {
  if (autoCheckTimer !== null) {
    clearTimeout(autoCheckTimer)
    autoCheckTimer = null
  }
}

function scheduleAutoCheck(options: { retry?: boolean } = {}) {
  clearAutoCheckTimer()
  if (!initialized || !settingsStore.value.updateAutoCheck || updateBusy.value)
    return

  let wait = AUTO_CHECK_INITIAL_DELAY_MS
  if (options.retry) {
    wait = AUTO_CHECK_RETRY_MS
  }
  else {
    const last = settingsStore.value.updateLastCheckAt
    if (last > 0) {
      const due = last + AUTO_CHECK_INTERVAL_MS
      wait = due <= Date.now() ? AUTO_CHECK_INITIAL_DELAY_MS : due - Date.now()
    }
  }

  wait = Math.min(wait, AUTO_CHECK_INTERVAL_MS)
  autoCheckTimer = setTimeout(() => {
    autoCheckTimer = null
    void runAutomaticCheck()
  }, wait)
}

async function runAutomaticCheck() {
  if (!settingsStore.value.updateAutoCheck || updateBusy.value || updateChecking.value) {
    scheduleAutoCheck()
    return
  }
  const checked = await checkForUpdate({ manual: false })
  if (checked)
    scheduleAutoCheck()
  else
    scheduleAutoCheck({ retry: true })
}

/**
 * Check the selected channel. Automatic checks are silent and remember a failure
 * so the next one is an hour away; manual checks surface errors through the
 * service interceptor and show skipped versions again.
 */
export async function checkForUpdate(options: { manual?: boolean } = {}): Promise<UpdateInfo | null> {
  const manual = options.manual === true
  if (updateBusy.value || updateChecking.value)
    return null

  updateChecking.value = true
  updateErrorMessage.value = ''
  updateStatus.value = { active: false }
  if (manual)
    updateInfo.value = null

  try {
    const info = await checkUpdate(updateChannel.value, { isToast: manual })
    updateInfo.value = info
    settingsStore.value.updateLastCheckAt = Date.now()

    const skipped = info.tag === settingsStore.value.updateSkippedVersion
    if (info.available && (manual || !skipped))
      updateDialogVisible.value = true
    return info
  }
  catch {
    if (manual)
      updateInfo.value = null
    return null
  }
  finally {
    updateChecking.value = false
  }
}

export async function installAvailableUpdate() {
  const release = updateInfo.value
  if (!release?.available || updateBusy.value)
    return

  updateDialogVisible.value = true
  updateErrorMessage.value = ''
  updateInstalling.value = true
  updateStatus.value = { active: true, phase: 'download', from: release.current, to: release.latest }

  try {
    await installGitHubUpdate(release.tag, { isToast: false })
    window.$message?.success(`${$t('file_lite_i18n.updated_restarting')}${ELLIPSIS}`)
    void waitForRestart()
  }
  catch (error) {
    updateInstalling.value = false
    if (httpStatus(error) === 409) {
      updateDialogVisible.value = true
      return
    }
    const message = errorText(error)
    updateErrorMessage.value = message
    updateStatus.value = { active: false, phase: updateStatus.value.phase, error: message }
    updateDialogVisible.value = true
    scheduleAutoCheck()
  }
}

export function remindLater() {
  updateDialogVisible.value = false
}

export function skipAvailableVersion() {
  const tag = updateInfo.value?.tag
  if (tag)
    settingsStore.value.updateSkippedVersion = tag
  updateDialogVisible.value = false
}

/**
 * The backend answers before it restarts, and the old process can keep serving
 * for a moment. Wait past the restart delay, then poll until the new process
 * answers and reload into it.
 */
async function waitForRestart() {
  if (restarting)
    return
  restarting = true

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

function httpStatus(error: unknown): number | undefined {
  return (error as { response?: { status?: number } } | null)?.response?.status
}

function errorText(error: unknown): string {
  const response = (error as { response?: { data?: { message?: string } } } | null)?.response
  if (response?.data?.message)
    return response.data.message
  return error instanceof Error ? error.message : String(error)
}

function handleUpdateMessage(message: UpdateWsMessage) {
  updateStatus.value = message

  if (message.type === 'snapshot') {
    if (message.active)
      updateDialogVisible.value = true
    return
  }

  if (message.type === 'progress') {
    updateErrorMessage.value = ''
    return
  }

  updateInstalling.value = false

  if (message.type === 'error') {
    updateErrorMessage.value = message.error ?? ''
    updateDialogVisible.value = true
    scheduleAutoCheck()
    return
  }

  updateErrorMessage.value = ''
  if (!message.error)
    void waitForRestart()
}

function onWindowActive() {
  if (document.visibilityState !== 'visible')
    return
  scheduleAutoCheck()
}

function bindSettingsWatchers() {
  stopWatchers = [
    watch(() => settingsStore.value.updateAutoCheck, () => scheduleAutoCheck()),
    watch(() => settingsStore.value.updateLastCheckAt, () => scheduleAutoCheck()),
    watch(() => settingsStore.value.updateChannel, () => {
      if (updateBusy.value)
        return
      updateInfo.value = null
      updateErrorMessage.value = ''
      updateDialogVisible.value = false
    }),
    watch(updateBusy, (busy) => {
      if (busy)
        clearAutoCheckTimer()
      else
        scheduleAutoCheck()
    }),
  ]
}

export async function initializeUpdateCenter() {
  if (initialized)
    return
  initialized = true
  restarting = false

  stopListening = subscribeSharedWsMessage((message) => {
    if (isUpdateMessage(message))
      handleUpdateMessage(message)
  })
  document.addEventListener('visibilitychange', onWindowActive)
  window.addEventListener('focus', onWindowActive)

  await ensureSettingsStoreInitialized().catch(error => console.error(error))
  bindSettingsWatchers()

  try {
    const snapshot = await getUpdateStatus()
    if (snapshot.active) {
      updateStatus.value = snapshot
      updateDialogVisible.value = true
    }
  }
  catch {
    // The endpoints are optional; a failure here must not block the version line.
  }

  scheduleAutoCheck()
}

export function disposeUpdateCenter() {
  if (!initialized)
    return
  initialized = false
  clearAutoCheckTimer()
  stopListening?.()
  stopListening = null
  document.removeEventListener('visibilitychange', onWindowActive)
  window.removeEventListener('focus', onWindowActive)
  for (const stop of stopWatchers)
    stop()
  stopWatchers = []

  // A user signing out must not see the previous session's prompt after signing in again.
  updateChecking.value = false
  updateInstalling.value = false
  updateInfo.value = null
  updateStatus.value = { active: false }
  updateDialogVisible.value = false
  updateErrorMessage.value = ''
}
