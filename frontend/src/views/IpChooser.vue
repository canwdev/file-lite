<script setup lang="ts">
import type { LoginTicketTier } from '@/api/session'
import { useIntervalFn } from '@vueuse/core'
import { useQRCode } from '@vueuse/integrations/useQRCode'
import axios from 'axios'
import { createLoginTicket } from '@/api/session'
import { authSessionRenewable } from '@/store/auth'
import { copyWithToast } from '@/utils'

const currentUrl = ref('')
const hostUrls = ref<string[]>([])
const loading = ref(false)
const errorMessage = ref('')
const restrictedError = ref(false)
const expiresAtMs = ref(0)
const nowMs = ref(Date.now())

// The unit wording lives in i18n as "{0} minutes" / "{0} hours"; the number is
// interpolated here so every locale only owns its own unit text.
interface TierOption {
  value: LoginTicketTier
  count?: number
  unit?: 'minutes' | 'hour' | 'hours'
  labelKey?: 'ticket_tier_persistent'
}

const tierOptions: TierOption[] = [
  { value: '15m', count: 15, unit: 'minutes' },
  { value: '1h', count: 1, unit: 'hour' },
  { value: '8h', count: 8, unit: 'hours' },
  { value: '24h', count: 24, unit: 'hours' },
  { value: 'persistent', labelKey: 'ticket_tier_persistent' },
]
const selectedTier = ref<LoginTicketTier>('1h')

// The ticket embedded in every URL lives for five minutes, so the page has to
// show how long the QR code is still good for.
useIntervalFn(() => {
  nowMs.value = Date.now()
}, 1000)

const remainingSeconds = computed(() => {
  if (!expiresAtMs.value)
    return 0
  return Math.max(0, Math.ceil((expiresAtMs.value - nowMs.value) / 1000))
})
const isExpired = computed(() => expiresAtMs.value > 0 && remainingSeconds.value === 0)
const remainingLabel = computed(() => {
  const total = remainingSeconds.value
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
})

const qrcode = useQRCode(currentUrl, {
  errorCorrectionLevel: 'H',
  margin: 2,
})

function tierLabel(option: TierOption) {
  if (option.labelKey) {
    return $t(`file_lite_i18n.${option.labelKey}`)
  }
  return $t(`file_lite_i18n.ticket_tier_${option.unit}`, [option.count ?? 0])
}

function isIpv4Url(url: string) {
  return /^https?:\/\/\d{1,3}(\.\d{1,3}){3}([:/?]|$)/.test(url)
}

function isLoopbackUrl(url: string) {
  return /^https?:\/\/(127\.|\[::1\]|localhost)/.test(url)
}

/** The QR code is scanned by another device, where loopback means nothing. */
function pickDefaultUrl(urls: string[]) {
  const lan = urls.find(url => isIpv4Url(url) && !isLoopbackUrl(url))
  if (lan)
    return lan
  const sameHost = urls.find(url => url.includes(location.hostname))
  return sameHost ?? urls[0] ?? ''
}

/** Host and port identify an address; every mint changes the ticket query. */
function addressKey(url: string) {
  try {
    return new URL(url).host
  }
  catch {
    return ''
  }
}

/**
 * Keep the address the user picked across a refresh. The URL text itself is
 * new after every mint (the ticket changes), so the previous selection is
 * matched by host and port and only falls back to the default when that
 * address is gone.
 */
function pickUrl(urls: string[], previousUrl: string) {
  const previousKey = addressKey(previousUrl)
  const match = previousKey
    ? urls.find(url => addressKey(url) === previousKey)
    : undefined
  return match ?? pickDefaultUrl(urls)
}

/**
 * Ask the backend for a fresh ticket and address list. Each address gets its
 * own single-use ticket, so the returned URLs are alternatives; a mint replaces
 * the previous batch. A temporary session cannot mint tickets at all; the
 * server returns 403 and the page explains why instead of showing a QR code.
 */
async function loadInfo() {
  if (!authSessionRenewable.value) {
    restrictedError.value = true
    return
  }
  // The select and the refresh button are disabled while loading; this guard
  // also serializes the mount call with a fast user interaction.
  if (loading.value) {
    return
  }
  loading.value = true
  errorMessage.value = ''
  restrictedError.value = false
  // Read before awaiting, so the selection from before the refresh survives.
  const previousUrl = currentUrl.value
  try {
    const info = await createLoginTicket(selectedTier.value)
    hostUrls.value = info.urls ?? []
    expiresAtMs.value = info.expiresAt ? new Date(info.expiresAt).getTime() : 0
    nowMs.value = Date.now()
    currentUrl.value = pickUrl(hostUrls.value, previousUrl)
    if (info.tier)
      selectedTier.value = info.tier
  }
  catch (error) {
    console.error('Failed to load IP chooser info:', error)
    hostUrls.value = []
    currentUrl.value = ''
    expiresAtMs.value = 0
    if (axios.isAxiosError(error) && error.response?.status === 403) {
      restrictedError.value = true
    }
    else {
      errorMessage.value = $t('file_lite_i18n.could_not_load_the_connection_in')
    }
  }
  finally {
    loading.value = false
  }
}

onMounted(() => {
  void loadInfo()
})

function handleGo(url: string) {
  location.href = url
}
</script>

<template>
  <div class="ip-chooser">
    <div class="ip-frame">
      <div class="ip-head">
        <RouterLink class="vgo-button vgo-button--text vgo-button--icon" :to="{ name: 'HomeView' }" :title="$t('file_lite_i18n.home')">
          <i-mdi-home class="vgo-u-icon-lg" />
        </RouterLink>
      </div>

      <div v-if="restrictedError || !authSessionRenewable" class="ip-status vgo-empty">
        <span>{{ $t('file_lite_i18n.ticket_share_requires_full_session') }}</span>
        <RouterLink class="vgo-button vgo-button--sm" :to="{ name: 'HomeView' }">
          {{ $t('file_lite_i18n.home') }}
        </RouterLink>
      </div>
      <div v-else-if="loading" class="ip-status vgo-empty">
        {{ $t('file_lite_i18n.loading') }}…
      </div>
      <div v-else-if="errorMessage" class="ip-status vgo-empty">
        <span>{{ errorMessage }}</span>
        <button class="vgo-button vgo-button--sm" @click="loadInfo">
          {{ $t('file_lite_i18n.retry') }}
        </button>
      </div>
      <div v-else-if="!hostUrls.length" class="ip-status vgo-empty">
        <span>{{ $t('file_lite_i18n.no_locations_available') }}</span>
        <button class="vgo-button vgo-button--sm" @click="loadInfo">
          {{ $t('file_lite_i18n.refresh') }}
        </button>
      </div>

      <!-- One body for both widths: the list scrolls, the QR column stays.
           Narrow screens stack the column above the list via `order`. -->
      <div v-else class="ip-body">
        <div class="ip-list vgo-panel vgo-u-scrollbar vgo-u-font-code">
          <div
            v-for="url in hostUrls"
            :key="url"
            class="vgo-list-item url-item"
            :class="{ 'is-active': url === currentUrl }"
            @click="currentUrl = url"
          >
            <span class="url-text">{{ url }}</span>
            <div class="url-actions">
              <button class="vgo-button vgo-button--text vgo-button--icon vgo-button--sm" :title="$t('file_lite_i18n.copy')" @click="copyWithToast(url)">
                <i-mdi-content-copy />
              </button>
              <button class="vgo-button vgo-button--text vgo-button--icon vgo-button--sm" :title="$t('file_lite_i18n.open')" @click="handleGo(url)">
                <i-mdi-open-in-new />
              </button>
            </div>
          </div>
        </div>

        <aside class="ip-side vgo-panel">
          <div class="ip-tier">
            <label class="ip-tier__field">
              <span class="ip-tier__label">{{ $t('file_lite_i18n.ticket_tier') }}</span>
              <select v-model="selectedTier" class="vgo-input" :disabled="loading" @change="loadInfo">
                <option v-for="tier in tierOptions" :key="tier.value" :value="tier.value">{{ tierLabel(tier) }}</option>
              </select>
            </label>
          </div>
          <img v-if="qrcode && currentUrl" :src="qrcode" class="qr-img" :alt="$t('file_lite_i18n.qr_code_generator')">
          <textarea v-model="currentUrl" class="vgo-input url-field vgo-u-font-code" rows="2" :placeholder="$t('file_lite_i18n.qr_code_generator')" />
          <div class="qr-meta">
            <span v-if="isExpired" class="vgo-badge vgo-badge--danger">{{ $t('file_lite_i18n.expired') }}</span>
            <span v-else-if="expiresAtMs" class="ip-expiry">{{ $t('file_lite_i18n.expires_in') }} {{ remainingLabel }}</span>
            <button class="vgo-button vgo-button--text vgo-button--sm" :disabled="loading" @click="loadInfo">
              <i-mdi-refresh /> {{ $t('file_lite_i18n.refresh') }}
            </button>
          </div>
        </aside>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.ip-chooser {
  height: 100%;
  overflow: hidden;
  padding: var(--vgo-space-4);
  box-sizing: border-box;

  @media screen and (max-width: 719px) {
    padding: var(--vgo-space-2);
  }
}

.ip-frame {
  display: flex;
  flex-direction: column;
  gap: var(--vgo-space-3);
  height: 100%;
  max-width: 1100px;
  min-height: 0;
  margin-inline: auto;
}

.ip-head {
  flex: none;
}

.ip-status {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--vgo-space-2);
  align-items: center;
  justify-content: center;
}

// Shared by both breakpoints. The list is the scrollport; the QR column
// keeps its own box and only scrolls if the viewport is shorter than the code.
.ip-body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--vgo-space-4);
  min-height: 0;
}

.ip-list {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
}

.url-item {
  align-items: flex-start;
  justify-content: space-between;
  padding: var(--vgo-space-3);

  & + & {
    border-top: 1px solid var(--vgo-border);
  }
}

.url-text {
  flex: 1;
  min-width: 0;
  padding-top: var(--vgo-space-1);
  word-break: break-all;
}

.url-actions {
  display: flex;
  flex: none;
  align-items: center;
}

.ip-side {
  display: flex;
  flex: none;
  flex-direction: column;
  gap: var(--vgo-space-3);
  align-items: center;
  order: -1;
  // Leave the list a few rows. The code itself only scrolls when the window is shorter than that.
  max-height: calc(100% - 8rem);
  padding: var(--vgo-space-4);
  overflow: auto;
}

.qr-img {
  width: min(16rem, 100%);
  height: auto;
  border-radius: var(--vgo-radius);
  image-rendering: pixelated;
}

.url-field {
  width: 100%;
  min-height: calc(var(--vgo-control-lg) * 2);
  font-size: var(--vgo-font-md);
  line-height: 1.4;
  resize: vertical;
}

.ip-tier {
  display: flex;
  width: 100%;
  flex-direction: column;
  gap: var(--vgo-space-1);
}

.ip-tier__field {
  display: flex;
  flex-direction: column;
  gap: var(--vgo-space-1);
}

.ip-tier__label {
  font-size: var(--vgo-font-sm);
}

.qr-meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--vgo-space-2);
  align-items: center;
  justify-content: center;
}

.ip-expiry {
  font-size: var(--vgo-font-sm);
}

@media screen and (min-width: 720px) {
  .ip-body {
    flex-direction: row;
    align-items: flex-start;
  }

  // Grow across the row, but only as tall as the addresses — capped so a long list scrolls on its own.
  .ip-list {
    flex: 1;
    align-self: flex-start;
    min-width: 0;
    max-height: 100%;
  }

  .ip-side {
    position: sticky;
    top: 0;
    flex: none;
    align-self: flex-start;
    order: 0;
    width: 20rem;
    max-height: 100%;
  }
}
</style>
