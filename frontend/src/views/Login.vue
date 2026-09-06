<script lang="ts" setup>
import type { InputInstance } from 'element-plus'
import { useStorage } from '@vueuse/core'
import { fsWebApi } from '@/api/filesystem'
import { LsKeys } from '@/enum'
import { authToken, rememberAuth } from '@/store/auth'

const router = useRouter()
const route = useRoute()

type LoginTab = 'password' | 'ticket'

const activeTabStored = useStorage<LoginTab>(LsKeys.LOGIN_ACTIVE_TAB, 'password', localStorage, {
  listenToStorageChanges: false,
})

const activeTab = computed({
  get: () => activeTabStored.value,
  set: (v: LoginTab) => {
    activeTabStored.value = v
  },
})
const inputValue = ref('')
const isSubmitting = ref(false)
const rememberLogin = computed({
  get: () => Boolean(rememberAuth.value),
  set: (value: boolean) => {
    rememberAuth.value = value
  },
})

const inputPlaceholder = computed(() => activeTab.value === 'password' ? 'Input password' : 'Input ticket')

async function finishLogin(res: { token: string }) {
  authToken.value = res.token

  if (route.query.redirect) {
    await router.push({ path: route.query.redirect as string })
  }
  else {
    await router.push({ path: '/' })
  }
}

async function doSubmit() {
  if (isSubmitting.value)
    return
  isSubmitting.value = true
  try {
    if (activeTab.value === 'password')
      await finishLogin(await fsWebApi.login(inputValue.value))
    else
      await finishLogin(await fsWebApi.consumeTicket(inputValue.value))
  }
  catch (error) {
    console.error(error)
  }
  finally {
    isSubmitting.value = false
  }
}

const inputRef = ref<InputInstance>()

function focusActiveTabInput() {
  nextTick(() => {
    inputRef.value?.focus()
  })
}

watch(activeTabStored, focusActiveTabInput)

onMounted(async () => {
  inputValue.value = ''
  focusActiveTabInput()
})
</script>

<template>
  <div class="auth-wrapper">
    <div class="login-card vgo-panel">
      <div class="login-header">
        <RouterLink to="/" class="login-icon">
          <i-mdi-key-outline />
        </RouterLink>
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
        <el-tab-pane label="Password" name="password" />
        <el-tab-pane label="Ticket" name="ticket" />
      </el-tabs>
      <div class="login-form">
        <el-input
          ref="inputRef" v-model="inputValue" type="password" clearable show-password
          size="large" :placeholder="inputPlaceholder" @keyup.enter="doSubmit"
        />
        <el-button type="primary" size="large" :loading="isSubmitting" @click="doSubmit">
          Sign In
        </el-button>
      </div>
      <div class="login-tip" />
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
    padding: var(--vgo-space-4);
    box-sizing: border-box;
  }

  .login-header {
    display: flex;
    gap: var(--vgo-space-3);
    align-items: center;
    margin-bottom: var(--vgo-space-4);
  }

  .login-icon {
    width: 46px;
    height: 46px;
    border-radius: var(--vgo-radius-pill);
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: var(--vgo-primary-opacity);
    color: var(--vgo-primary);
    font-size: 26px;
  }

  .login-title {
    font-size: 24px;
    font-weight: bold;
    line-height: 1.2;
  }

  .login-subtitle {
    margin-top: var(--vgo-space-1);
    font-size: var(--vgo-font-sm);
    color: var(--vgo-text-secondary);
  }

  .login-tabs {
    width: 100%;
  }

  .login-form {
    display: grid;
    gap: var(--vgo-space-3);
    padding-top: var(--vgo-space-2);
  }

  .login-tip {
    margin-top: var(--vgo-space-2);
    font-size: var(--vgo-font-sm);
    color: var(--vgo-text-secondary);
  }

  .login-options {
    margin-top: var(--vgo-space-4);
  }

  .login-option-tip {
    margin-top: 2px;
    font-size: var(--vgo-font-sm);
    color: var(--vgo-text-secondary);
  }
}
</style>
