<script setup lang="ts">
import { useQRCode } from '@vueuse/integrations/useQRCode'
import { copyWithToast } from '@/utils'

const currentUrl = ref('')
const hostUrls = ref<string[]>([])
const route = useRoute()

watch(
  () => route.query.urls,
  (newVal) => {
    if (newVal) {
      hostUrls.value = JSON.parse(atob(route.query.urls as string))
    }
    else {
      hostUrls.value = [location.href]
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
      <RouterLink :to="{ name: 'HomeView' }">
        <span class="mdi mdi-home" style="font-size: 26px" />
      </RouterLink>
    </div>
    <!-- <div class="ip-title">
      <span class="mdi mdi-ip-network"></span>
      Select the URL you want to visit:
    </div> -->
    <div class="ip-chooser-main vgo-panel font-code">
      <div class="left-box">
        <div
          v-for="url in hostUrls"
          :key="url"
          class="list-item"
          :class="{ active: url === currentUrl }"
          @click="currentUrl = url"
        >
          {{ url }}

          <div class="flex-row-center-gap">
            <button class="btn-go btn-no-style" @click="copyWithToast(url)">
              <span class="mdi mdi-content-copy" />
            </button>
            <button class="btn-go btn-no-style" @click="handleGo(url)">
              <span class="mdi mdi-open-in-new" />
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
    font-size: 16px;
    margin-bottom: 16px;
  }

  .ip-chooser-main {
    max-width: 500px;
    margin-left: auto;
    margin-right: auto;
    display: flex;
    flex-direction: column;

    .left-box {
      display: flex;
      flex-direction: column;
      border-bottom: 1px solid var(--vgo-color-border);

      .list-item {
        padding: 16px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        word-break: break-all;
        font-size: 14px;

        &:nth-child(2n) {
          background-color: rgba(134, 134, 134, 0.1);
        }

        &:hover {
          background-color: var(--vgo-color-hover);
        }

        &.active {
          position: relative;
          background-color: var(--vgo-primary-opacity);

          &::before {
            position: absolute;
            display: block;
            content: '';
            left: 0;
            top: 8px;
            bottom: 8px;
            width: 4px;
            border-radius: 0 8px 8px 0;
            background-color: var(--vgo-primary);
          }
        }
      }
    }

    .right-box {
      flex: 1;
      padding: 20px 20px;
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
          border-radius: 4px;
          image-rendering: pixelated;
        }

        .url-text {
          margin-top: 8px;
          text-align: center;

          .vgo-input {
            font-size: 14px;
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
