<script setup lang="ts">
import { useIntervalFn } from '@vueuse/core'
import { useQRCode } from '@vueuse/integrations/useQRCode'
import { getIpChooserInfo } from '@/api/ip-chooser'
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
    const info = await getIpChooserInfo()
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
    <div class="ip-title">
      <RouterLink :to="{ name: 'HomeView' }">
        <i-mdi-home style="font-size: 26px" />
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

    <div v-else class="ip-chooser-main vgo-panel vgo-u-font-code">
      <div class="left-box">
        <div
          v-for="url in hostUrls"
          :key="url"
          class="vgo-list-item url-item"
          :class="{ 'is-active': url === currentUrl }"
          @click="currentUrl = url"
        >
          <span class="url-text-main">{{ url }}</span>

          <div class="vgo-u-flex-wrap-center">
            <button class="vgo-button vgo-button--text vgo-button--icon vgo-button--sm" title="Copy" @click="copyWithToast(url)">
              <i-mdi-content-copy />
            </button>
            <button class="vgo-button vgo-button--text vgo-button--icon vgo-button--sm" title="Open" @click="handleGo(url)">
              <i-mdi-open-in-new />
            </button>
          </div>
        </div>
      </div>
      <div class="right-box">
        <div class="qr-img-wrap">
          <img v-if="qrcode && currentUrl" :src="qrcode" class="qr-img">
          <div class="url-text">
            <textarea v-model="currentUrl" class="vgo-input" placeholder="QR Code generator" />
          </div>
          <div class="qr-meta">
            <span v-if="isExpired" class="vgo-badge vgo-badge--danger">Expired</span>
            <span v-else-if="expiresAtMs" class="ip-expiry">Expires in {{ remainingLabel }}</span>
            <button class="vgo-button vgo-button--text vgo-button--sm" @click="loadInfo">
              <i-mdi-refresh />
              Refresh
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.ip-chooser {
  height: 100%;
  overflow: auto;
  padding: 20px 20px;
  box-sizing: border-box;

  @media screen and (max-width: 500px) {
    padding: 10px;
  }

  .ip-title {
    text-align: center;
    font-size: var(--vgo-font-lg);
    margin-bottom: var(--vgo-space-4);
  }

  .ip-status {
    max-width: 600px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--vgo-space-2);
  }

  .ip-chooser-main {
    max-width: 600px;
    margin-left: auto;
    margin-right: auto;
    display: flex;
    flex-direction: column;

    .left-box {
      display: flex;
      flex-direction: column;
      border-bottom: 1px solid var(--vgo-border);

      .url-item {
        padding: var(--vgo-space-4);
        justify-content: space-between;

        .url-text-main {
          word-break: break-all;
        }
      }
    }

    .right-box {
      flex: 1;
      padding: var(--vgo-space-4);
      display: flex;
      align-items: center;
      justify-content: center;

      .qr-img-wrap {
        width: 100%;
        display: flex;
        flex-direction: column;
        gap: 2px;

        .qr-img {
          max-width: 256px;
          width: 100%;
          height: auto;
          display: flex;
          margin: 0 auto;
          border-radius: var(--vgo-radius);
          image-rendering: pixelated;
        }

        .url-text {
          margin-top: var(--vgo-space-2);
          text-align: center;

          .vgo-input {
            font-size: var(--vgo-font-md);
            width: 100%;
            line-height: 1;
            height: 60px;
          }
        }

        .qr-meta {
          margin-top: var(--vgo-space-2);
          display: flex;
          align-items: center;
          justify-content: center;
          gap: var(--vgo-space-2);

          .ip-expiry {
            font-size: var(--vgo-font-sm);
          }
        }
      }
    }
  }
}
</style>
