<script lang="ts" setup>
import {authToken} from '@/store'
const route = useRoute()
const router = useRouter()

const authTokenInput = ref('')
const confirmAuthToken = async () => {
  authToken.value = authTokenInput.value
  await router.push({path: '/'})
}
watch(authToken, (newVal) => {
  if (newVal) {
    authTokenInput.value = newVal
  }
})
const inputRef = ref<HTMLInputElement>()
onMounted(() => {
  inputRef.value?.focus()
})
</script>

<template>
  <div v-if="!authToken" class="auth-wrapper">
    <div class="vgo-panel">
      <div class="login-title">Login</div>
      <div class="flex-row-center-gap">
        <el-input
          ref="inputRef"
          type="password"
          clearable
          show-password
          v-model="authTokenInput"
          placeholder="Input auth token"
          @keyup.enter="confirmAuthToken"
          style="width: 200px"
        />
        <el-button @click="confirmAuthToken" type="primary">OK</el-button>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.auth-wrapper {
  padding: 10px 0;
  width: 100%;
  height: 100%;
  overflow: auto;
  box-sizing: border-box;
  .vgo-panel {
    padding: 40px 50px 50px;
    gap: 10px;
    margin-top: 35vh;
    margin-left: auto;
    margin-right: auto;
    width: fit-content;
  }
  .login-title {
    font-size: 20px;
    font-weight: bold;
    margin-bottom: 10px;
  }
}
</style>
