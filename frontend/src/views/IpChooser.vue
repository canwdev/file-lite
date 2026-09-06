<script setup lang="ts">
import { useQRCode } from '@vueuse/integrations/useQRCode'
import { copyWithToast } from '@/utils'
import { decodeIpSelectorParams, formatHostForUrl } from '@/utils/ip-selector-codec'

const currentUrl = ref('')
const hostUrls = ref<string[]>([])
const ticketValue = ref('')
const route = useRoute()

function parseData() {
  try {
    const data = decodeIpSelectorParams(route.query.data as string)
    console.log(data)
    const { ips, port, protocol, ticket } = data
    ticketValue.value = ticket || ''
    hostUrls.value = ips.map((ip) => {
      const host = formatHostForUrl(ip)
      return ticket ? `${protocol}//${host}:${port}?ticket=${ticket}` : `${protocol}//${host}:${port}`
    })
  }
  catch (error) {
    console.error('Error parsing data:', error)
    ticketValue.value = ''
    hostUrls.value = []
  }
}

watch(
  () => route.query.data,
  (newVal) => {
    if (newVal) {
      parseData()
    }
    else {
      ticketValue.value = ''
      hostUrls.value = []
    }
    setTimeout(() => {
      autoSelectUrl()
    })
  },
  { immediate: true },
)

const qrcode = useQRCode(currentUrl, {
  errorCorrectionLevel: 'H',
  margin: 2,
})

function handleGo(url: string) {
  location.href = url
}
function autoSelectUrl() {
  const hostname = location.hostname

  let index = hostUrls.value.findIndex(url => url.includes(hostname))
  if (index === -1) {
    index = hostUrls.value.findIndex(url => url.includes('127.0.0.1'))
  }
  if (index !== -1) {
    currentUrl.value = hostUrls.value[index]
  }
}
</script>

<template>
  <div class="ip-chooser">
    <div class="ip-title">
      <RouterLink :to="{ name: 'HomeView', query: ticketValue ? { ticket: ticketValue } : undefined }">
        <i-mdi-home style="font-size: 26px" />
      </RouterLink>
    </div>
    <!-- <div class="ip-title">
      <i-mdi-ip-network />
      Select the URL you want to visit:
    </div> -->
    <div class="ip-chooser-main vgo-panel vgo-u-font-code">
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
      }
    }
  }
}
</style>
