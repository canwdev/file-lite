<script lang="ts" setup>
import {authToken} from '@/store'
import {fsWebApi} from '@/api/filesystem.ts'
import FileManager from '@/views/FileManager/FileManager.vue'
const route = useRoute()
const router = useRouter()
onMounted(() => {
  console.log(route.query)
  if (route.query.auth) {
    authToken.value = route.query.auth as string
    router.replace({query: {}})
  }
})

onMounted(async () => {
  await fsWebApi.getDrives()
})

const authTokenInput = ref('')
const confirmAuthToken = () => {
  authToken.value = authTokenInput.value
}
watch(authToken, (newVal) => {
  if (newVal) {
    authTokenInput.value = newVal
  }
})
</script>

<template>
  <div class="file-lite">
    <div v-if="!authToken" class="auth-wrapper">
      <div class="vgo-panel flex-row-center-gap">
        <input
          class="vgo-input"
          type="text"
          v-model="authTokenInput"
          placeholder="Input auth token"
          @keyup.enter="confirmAuthToken"
        />
        <button @click="confirmAuthToken" class="vgo-button primary">OK</button>
      </div>
    </div>
    <FileManager v-else />
  </div>
</template>

<style lang="scss" scoped>
.file-lite {
  height: 100%;
  .auth-wrapper {
    margin: 0 auto;
    width: fit-content;
    padding: 200px 0;
    .vgo-panel {
      padding: 50px;
      gap: 10px;
    }
  }
}
</style>
