<script lang="ts" setup>
import { fsWebApi } from '@/api/filesystem'
import { authToken, rememberAuth } from '@/store'

const router = useRouter()
const route = useRoute()

const activeTab = ref<'password' | 'ticket'>('password')
const passwordInput = ref('')
const ticketInput = ref('')
const isSubmitting = ref(false)
const rememberLogin = computed({
  get: () => Boolean(rememberAuth.value),
  set: (value: boolean) => {
    rememberAuth.value = value
  },
})

async function finishLogin(res: { token: string }) {
  authToken.value = res.token

  if (route.query.redirect) {
    await router.push({ path: route.query.redirect as string })
  }
  else {
    await router.push({ path: '/' })
  }
}

async function confirmPassword() {
  if (isSubmitting.value)
    return
  isSubmitting.value = true
  try {
    await finishLogin(await fsWebApi.login(passwordInput.value))
  }
  catch (error) {
    console.error(error)
  }
  finally {
    isSubmitting.value = false
  }
}

async function confirmTicket() {
  if (isSubmitting.value)
    return
  isSubmitting.value = true
  try {
    await finishLogin(await fsWebApi.consumeTicket(ticketInput.value))
  }
  catch (error) {
    console.error(error)
  }
  finally {
    isSubmitting.value = false
  }
}

onMounted(async () => {
  passwordInput.value = ''
  ticketInput.value = ''
})

const inputRef = ref<HTMLInputElement>()
onMounted(() => {
  inputRef.value?.focus()
})
</script>

<template>
  <div class="auth-wrapper app-soft-bg">
    <div class="login-card vgo-panel">
      <div class="login-header">
        <div class="login-icon">
          <span class="mdi mdi-key-outline" />
        </div>
        <div>
          <div class="login-title">
            Welcome
          </div>
          <div class="login-subtitle">
            Sign in to access File Lite
          </div>
        </div>
      </div>
      <el-tabs v-model="activeTab" class="login-tabs">
        <el-tab-pane label="Password" name="password">
          <div class="login-form">
            <el-input
              ref="inputRef" v-model="passwordInput" type="password" clearable show-password
              size="large" placeholder="Input password" @keyup.enter="confirmPassword"
            />
            <el-button type="primary" size="large" :loading="isSubmitting" @click="confirmPassword">
              Sign In
            </el-button>
          </div>
        </el-tab-pane>
        <el-tab-pane label="Ticket" name="ticket">
          <div class="login-form">
            <el-input
              v-model="ticketInput" clearable size="large"
              placeholder="Input ticket" @keyup.enter="confirmTicket"
            />
            <el-button type="primary" size="large" :loading="isSubmitting" @click="confirmTicket">
              Sign In
            </el-button>
          </div>
          <div class="login-tip" />
        </el-tab-pane>
      </el-tabs>
      <div class="login-options">
        <el-checkbox v-model="rememberLogin" title="If unchecked, login status will be cleared when browser is closed">
          Remember login status
        </el-checkbox>
        <div class="login-option-tip" />
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.auth-wrapper {
  padding: 24px;
  width: 100%;
  height: 100%;
  overflow: auto;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;

  .login-card {
    width: min(420px, 100%);
    padding: 34px 36px 32px;
    box-sizing: border-box;
    border: 1px solid var(--vgo-color-border);
    box-shadow: 0 18px 48px rgba(0, 0, 0, 0.16);
    backdrop-filter: blur(8px);
  }

  .login-header {
    display: flex;
    gap: 14px;
    align-items: center;
    margin-bottom: 22px;
  }

  .login-icon {
    width: 46px;
    height: 46px;
    border-radius: 50px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--vgo-primary-opacity);
    color: var(--vgo-primary);
    font-size: 26px;
  }

  .login-title {
    font-size: 24px;
    font-weight: bold;
    line-height: 1.2;
  }

  .login-subtitle {
    margin-top: 4px;
    font-size: 13px;
    color: var(--vgo-color-secondary);
  }

  .login-tabs {
    width: 100%;
  }

  .login-form {
    display: grid;
    gap: 12px;
    padding-top: 8px;
  }

  .login-tip {
    margin-top: 8px;
    font-size: 12px;
    color: var(--vgo-color-secondary);
  }

  .login-options {
    margin-top: 18px;
  }

  .login-option-tip {
    margin-top: 2px;
    font-size: 12px;
    color: var(--vgo-color-secondary);
  }
}
</style>
