<script setup lang="ts">
import { useIntervalFn } from '@vueuse/core'
import { useQRCode } from '@vueuse/integrations/useQRCode'
import { createLoginTicket } from '@/api/session'
import { copyWithToast } from '@/utils'

const currentUrl = ref('')
const hostUrls = ref<string[]>([])
const loading = ref(false)
const errorMessage = ref('')
const expiresAtMs = ref(0)
const nowMs = ref(Date.now())

// The ticket embedded in every URL lives for two minutes, so the page has to
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

/**
 * Ask the backend for a fresh ticket and address list. The backend keeps a
 * single global ticket, so every call invalidates the URLs from the last one.
 */
async function loadInfo() {
  loading.value = true
  errorMessage.value = ''
  try {
    const info = await createLoginTicket()
    hostUrls.value = info.urls ?? []
    expiresAtMs.value = info.expiresAt ? new Date(info.expiresAt).getTime() : 0
    nowMs.value = Date.now()
    currentUrl.value = pickDefaultUrl(hostUrls.value)
  }
  catch (error) {
    console.error('Failed to load IP chooser info:', error)
    hostUrls.value = []
    currentUrl.value = ''
    expiresAtMs.value = 0
    errorMessage.value = 'Could not load the connection info.'
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
        <RouterLink class="vgo-button vgo-button--text vgo-button--icon" :to="{ name: 'HomeView' }" title="Home">
          <i-mdi-home class="vgo-u-icon-lg" />
        </RouterLink>
      </div>

      <div v-if="loading" class="ip-status vgo-empty">
        Loading…
      </div>
      <div v-else-if="errorMessage" class="ip-status vgo-empty">
        <span>{{ errorMessage }}</span>
        <button class="vgo-button vgo-button--sm" @click="loadInfo">
          Retry
        </button>
      </div>
      <div v-else-if="!hostUrls.length" class="ip-status vgo-empty">
        <span>No reachable address was found.</span>
        <button class="vgo-button vgo-button--sm" @click="loadInfo">
          Refresh
        </button>
      </div>

      <!-- One body for both widths: the list scrolls, the QR column stays.
           Narrow screens stack the column above the list via `order`. -->
      <div v-else class="ip-body vgo-u-font-code">
        <div class="ip-list vgo-panel vgo-u-scrollbar">
          <div
            v-for="url in hostUrls"
            :key="url"
            class="vgo-list-item url-item"
            :class="{ 'is-active': url === currentUrl }"
            @click="currentUrl = url"
          >
            <span class="url-text">{{ url }}</span>
            <div class="url-actions">
              <button class="vgo-button vgo-button--text vgo-button--icon vgo-button--sm" title="Copy" @click="copyWithToast(url)">
                <i-mdi-content-copy />
              </button>
              <button class="vgo-button vgo-button--text vgo-button--icon vgo-button--sm" title="Open" @click="handleGo(url)">
                <i-mdi-open-in-new />
              </button>
            </div>
          </div>
        </div>

        <aside class="ip-side vgo-panel">
          <img v-if="qrcode && currentUrl" :src="qrcode" class="qr-img" alt="Login QR code">
          <textarea v-model="currentUrl" class="vgo-input url-field" rows="2" placeholder="QR Code generator" />
          <div class="qr-meta">
            <span v-if="isExpired" class="vgo-badge vgo-badge--danger">Expired</span>
            <span v-else-if="expiresAtMs" class="ip-expiry">Expires in {{ remainingLabel }}</span>
            <button class="vgo-button vgo-button--text vgo-button--sm" @click="loadInfo">
              <i-mdi-refresh />
              Refresh
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
