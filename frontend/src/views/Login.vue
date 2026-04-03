<script lang="ts" setup>
import { fsWebApi } from '@/api/filesystem'
import { authToken } from '@/store'

const router = useRouter()
const route = useRoute()

const authTokenInput = ref('')
async function confirmAuthToken() {
  authToken.value = authTokenInput.value

  try {
    await fsWebApi.auth()
  }
  catch (error) {
    console.error(error)
    return
  }

  if (route.query.redirect) {
    await router.push({ path: route.query.redirect as string })
  }
  else {
    await router.push({ path: '/' })
  }
}

onMounted(async () => {
  if (authToken.value) {
    authTokenInput.value = authToken.value
  }
})

const inputRef = ref<HTMLInputElement>()
onMounted(() => {
  inputRef.value?.focus()
})
</script>

<template>
  <div class="auth-wrapper">
    <div class="vgo-panel">
      <div class="login-title">
        Login
      </div>
      <div class="flex-row-center-gap">
        <el-input
          ref="inputRef" v-model="authTokenInput" type="password" clearable show-password
          placeholder="Input auth token" style="width: 200px" @keyup.enter="confirmAuthToken"
        />
        <el-button type="primary" @click="confirmAuthToken">
          OK
        </el-button>
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
