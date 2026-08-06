<script lang="ts" setup>
import type { SpeedMetrics } from '@/api/speed-test'
import { runDownloadSpeedTest, runUploadSpeedTest } from '@/api/speed-test'

const DEFAULT_SIZE_MB = 500
const ONE_MB = 1024 * 1024
type SpeedTestPhase = 'idle' | 'download' | 'upload' | 'done'
type SpeedMetricKey = 'avg' | 'max' | 'current'

const sizeMB = ref(DEFAULT_SIZE_MB)
const running = ref(false)
const phase = ref<SpeedTestPhase>('idle')
const downloadMetrics = ref<SpeedMetrics | null>(null)
const uploadMetrics = ref<SpeedMetrics | null>(null)

const metricRows: Array<{ key: SpeedMetricKey, label: string }> = [
  { key: 'avg', label: 'Average' },
  { key: 'max', label: 'Max' },
  { key: 'current', label: 'Current' },
]

let currentAbortController: AbortController | null = null

const phaseText = computed(() => {
  switch (phase.value) {
    case 'download':
      return 'Downloading'
    case 'upload':
      return 'Uploading'
    case 'done':
      return 'Done'
    default:
      return 'Idle'
  }
})

const cards = computed(() => [
  {
    key: 'download',
    title: 'Download',
    icon: 'mdi mdi-arrow-down-bold-circle-outline',
    actionLabel: 'Test',
    phase: 'download' as const,
    metrics: downloadMetrics.value,
  },
  {
    key: 'upload',
    title: 'Upload',
    icon: 'mdi mdi-arrow-up-bold-circle-outline',
    actionLabel: 'Test ',
    phase: 'upload' as const,
    metrics: uploadMetrics.value,
  },
])

function isCardRunning(cardPhase: 'download' | 'upload') {
  return running.value && phase.value === cardPhase
}

function resetMetrics() {
  downloadMetrics.value = null
  uploadMetrics.value = null
}

function normalizeSizeMB() {
  const value = Number(sizeMB.value)
  sizeMB.value = Number.isFinite(value) ? Math.min(2048, Math.max(1, Math.floor(value))) : DEFAULT_SIZE_MB
}

function isAbortError(error: unknown) {
  return error instanceof Error && (error.name === 'AbortError' || (error as { code?: string }).code === 'ERR_CANCELED')
}

function formatSpeed(value: number | undefined) {
  return `${(value ?? 0).toFixed(2)}`
}

function formatTransferred(bytes: number | undefined) {
  return `${(((bytes ?? 0) / 1024 / 1024)).toFixed(2)} MB`
}

function formatMetric(metrics: SpeedMetrics | null, key: SpeedMetricKey) {
  if (!metrics) {
    return '0.00 MB/s'
  }

  return `${formatSpeed(metrics[`${key}MBps`])} MB/s`
}

function formatMetricTitle(metrics: SpeedMetrics | null, key: SpeedMetricKey) {
  if (!metrics) {
    return '0.00 Mb/s'
  }

  return `${formatSpeed(metrics[`${key}Mbps`])} Mb/s`
}

function getProgressPercent(metrics: SpeedMetrics | null) {
  const totalBytes = Math.max(1, Math.floor(Number(sizeMB.value) || DEFAULT_SIZE_MB) * ONE_MB)
  const loadedBytes = metrics?.bytes ?? 0
  return Math.min(100, Math.max(0, loadedBytes / totalBytes * 100))
}

async function runTest(target: 'download' | 'upload' | 'all') {
  if (running.value) {
    return
  }

  normalizeSizeMB()
  if (target === 'all') {
    resetMetrics()
  }
  else if (target === 'download') {
    downloadMetrics.value = null
  }
  else {
    uploadMetrics.value = null
  }

  running.value = true
  currentAbortController = new AbortController()

  try {
    if (target === 'download' || target === 'all') {
      phase.value = 'download'
      downloadMetrics.value = await runDownloadSpeedTest({
        sizeMB: sizeMB.value,
        signal: currentAbortController.signal,
        onProgress(metrics) {
          downloadMetrics.value = metrics
        },
      })
    }

    if (target === 'upload' || target === 'all') {
      phase.value = 'upload'
      uploadMetrics.value = await runUploadSpeedTest({
        sizeMB: sizeMB.value,
        signal: currentAbortController.signal,
        onProgress(metrics) {
          uploadMetrics.value = metrics
        },
      })
    }

    phase.value = 'done'
  }
  catch (error) {
    phase.value = 'idle'
    if (!isAbortError(error)) {
      console.error(error)
      window.$message.error(error instanceof Error ? error.message : 'Speed test failed')
    }
  }
  finally {
    currentAbortController = null
    running.value = false
  }
}

function startTest() {
  return runTest('all')
}

function startSingleTest(target: 'download' | 'upload') {
  return runTest(target)
}

function stopTest() {
  currentAbortController?.abort()
  currentAbortController = null
  running.value = false
  phase.value = 'idle'
}

onBeforeUnmount(() => {
  stopTest()
})
</script>

<template>
  <div class="speed-test-wrap">
    <div class="speed-test-toolbar">
      <label class="size-input-wrap">
        <span>Size(MB)</span>
        <input v-model.number="sizeMB" type="number" min="1" max="2048" class="vgo-input size-input" :disabled="running" :step="100">
      </label>
      <button type="button" class="vgo-button vgo-button--primary" :disabled="running" @click="startTest">
        Test All
      </button>
      <button type="button" class="vgo-button" :disabled="!running" @click="stopTest">
        Stop
      </button>
      <span class="phase-text">{{ phaseText }}</span>
    </div>

    <div class="speed-test-grid">
      <div
        v-for="card in cards"
        :key="card.key"
        class="speed-card vgo-panel"
        :class="{ 'is-active': running && phase === card.phase }"
      >
        <div class="speed-card-title">
          <div class="speed-card-progress" :style="{ width: `${getProgressPercent(card.metrics)}%` }" />
          <div class="speed-card-title-main">
            <span :class="card.icon" class="speed-card-icon" />
            <span>{{ card.title }}</span>
          </div>
          <button
            type="button"
            class="vgo-button vgo-button--sm speed-card-action"
            :disabled="running"
            @click="startSingleTest(card.phase)"
          >
            {{ card.actionLabel }}
          </button>
        </div>
        <div
          v-for="row in metricRows"
          v-show="row.key !== 'current' || isCardRunning(card.phase)"
          :key="row.key"
          class="speed-row"
          :class="{ average: row.key === 'avg' }"
        >
          <span class="speed-row-label">{{ row.label }}</span>
          <span class="speed-value" :title="formatMetricTitle(card.metrics, row.key)">
            {{ formatMetric(card.metrics, row.key) }}
          </span>
        </div>
        <div class="speed-row">
          <span class="speed-row-label">Transferred</span>
          <span class="speed-value">{{ formatTransferred(card.metrics?.bytes) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.speed-test-wrap {
  padding: var(--vgo-space-2);
  display: flex;
  flex-direction: column;
  gap: var(--vgo-space-2);
  max-width: 700px;
  margin: 0 auto;
}

.speed-test-toolbar {
  display: flex;
  align-items: center;
  gap: var(--vgo-space-2);
  border-bottom: 1px solid var(--vgo-border);
  padding-bottom: var(--vgo-space-2);
}

.size-input-wrap {
  display: flex;
  align-items: center;
  gap: var(--vgo-space-2);
  font-size: var(--vgo-font-md);
}

.size-input {
  width: 110px;
}

.phase-text {
  margin-left: auto;
  font-size: var(--vgo-font-sm);
  color: var(--vgo-text-secondary);
}

.speed-test-grid {
  flex: 1;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: var(--vgo-space-2);
}

.speed-card {
  display: flex;
  flex-direction: column;
  transition: border-color var(--vgo-duration-base) ease;
  overflow: hidden;
  padding-bottom: var(--vgo-space-2);

  &.is-active {
    border-color: var(--vgo-primary);

    .speed-card-title {
      color: var(--vgo-primary);
    }
  }
}

.speed-card-title {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--vgo-space-2);
  font-weight: 600;
  font-size: var(--vgo-font-md);
  padding: var(--vgo-space-2) var(--vgo-space-3);
  border-bottom: 1px solid var(--vgo-border);
  overflow: hidden;
}

.speed-card-title-main {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: var(--vgo-space-2);
}

.speed-card-icon {
  font-size: var(--vgo-icon-md);
}

.speed-card-progress {
  position: absolute;
  inset: 0 auto 0 0;
  background-color: var(--vgo-primary-opacity);
  pointer-events: none;
  transition: width var(--vgo-duration-fast) linear;
}

.speed-card-action {
  position: relative;
  z-index: 1;
  margin-left: auto;
}

.speed-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--vgo-space-3);
  font-size: var(--vgo-font-md);
  padding: var(--vgo-space-1) var(--vgo-space-3);
}

.speed-row-label {
  color: var(--vgo-text-secondary);
}

.speed-row.average .speed-row-label,
.speed-row.average .speed-value {
  color: var(--vgo-primary);
}

.speed-value {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
  font-size: var(--vgo-font-md);
  font-weight: 600;
  text-align: right;
}
</style>
