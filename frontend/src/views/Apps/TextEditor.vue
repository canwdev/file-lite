<script lang="ts" setup="">
import type { MenuBarOptions } from '@imengyu/vue3-context-menu'
import type { AppParams } from '@/views/Apps/apps.ts'
import { useUnSavedChanges } from '@canwdev/vgo-ui'
import { MenuBar } from '@imengyu/vue3-context-menu'
import { fsWebApi } from '@/api/filesystem'
import { menuThemeOptions } from '@/hooks/use-global-theme.ts'
import { bytesToSize } from '@/utils'
import { generateTextFile } from '@/views/FileManager/utils'

const props = withDefaults(
  defineProps<{
    appParams: AppParams
  }>(),
  {},
)

const emit = defineEmits(['exit', 'setTitle'])

// 5 MB
const SIZE_LIMIT = 5 * 1024 * 1024

const { appParams } = toRefs(props)
const absPath = computed(() => {
  return appParams.value?.absPath
})

const editRef = ref<HTMLTextAreaElement>()
const wrapRef = ref<HTMLElement>()
const editContent = ref('')
const isLoading = ref(false)
const { isChanged } = useUnSavedChanges()
watch(editContent, () => {
  isChanged.value = true
})

interface FileTooLarge {
  name: string
  size: number
}
const fileTooLarge = ref<FileTooLarge | null>(null)

async function focusEditor() {
  const focusTarget = () => editRef.value ?? wrapRef.value

  const tryFocus = () => {
    const el = focusTarget()
    if (!el) {
      return false
    }
    el.focus({ preventScroll: true })
    return document.activeElement === el
  }

  for (const delay of [0, 50, 150, 300]) {
    await new Promise(resolve => setTimeout(resolve, delay))
    await nextTick()
    if (tryFocus()) {
      return
    }
  }
}

function isMessageBoxOpen() {
  return !!document.querySelector('.el-message-box')
}

function shouldHandleEditorEscape() {
  const wrap = wrapRef.value
  if (!wrap?.isConnected) {
    return false
  }

  const active = document.activeElement
  if (active && wrap.contains(active)) {
    return true
  }

  // MessageBox closes with focus on body; keep Esc working in this editor.
  return active === document.body || active === document.documentElement
}

function onWindowKeydown(event: KeyboardEvent) {
  if (event.key?.toLowerCase() !== 'escape') {
    return
  }
  if (isMessageBoxOpen()) {
    return
  }
  if (!shouldHandleEditorEscape()) {
    return
  }

  event.preventDefault()
  event.stopPropagation()
  handleExit()
}

async function confirmUnsavedChanges(message: string) {
  try {
    await window.$dialog.confirm(message, 'Unsaved Changes', {
      type: 'warning',
      confirmButtonText: 'Continue',
      cancelButtonText: 'Cancel',
    })
    return true
  }
  catch {
    return false
  }
  finally {
    await focusEditor()
  }
}

async function openFile() {
  fileTooLarge.value = null
  try {
    isLoading.value = true
    emit('setTitle', absPath.value)
    editContent.value = ''

    if (!absPath.value) {
      return
    }

    const { item } = props.appParams
    if (item.size != null && item.size > SIZE_LIMIT) {
      fileTooLarge.value = { name: item.name, size: item.size }
      return
    }

    const data = await fsWebApi.stream(absPath.value, {
      responseType: 'text',
    })
    editContent.value = data as unknown as string
    setTimeout(() => {
      isChanged.value = false
    })
  }
  catch (error) {
    console.error('open file failed', error)
  }
  finally {
    isLoading.value = false
    await focusEditor()
  }
}

watch(
  () => props.appParams,
  () => {
    openFile()
  },
)

onMounted(() => {
  openFile()
  window.addEventListener('keydown', onWindowKeydown, true)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onWindowKeydown, true)
})

const isSaving = ref(false)
async function handleSaveFile() {
  if (isSaving.value) {
    return
  }
  try {
    isSaving.value = true

    if (!absPath.value) {
      throw new Error('absPath not exist!')
    }

    const idx = absPath.value.lastIndexOf('/') + 1
    const filename = absPath.value.slice(idx)
    await fsWebApi.uploadFile({
      path: absPath.value,
      file: generateTextFile(editContent.value, filename),
    })
    setTimeout(() => {
      isChanged.value = false
    })
  }
  catch (error) {
    console.error('save file failed', error)
  }
  finally {
    isSaving.value = false
  }
}

async function handleExit() {
  if (isChanged.value) {
    const confirmed = await confirmUnsavedChanges('Changes not saved. Continue to exit?')
    if (!confirmed) {
      return
    }
  }
  emit('exit')
}

const menuOptions = computed((): MenuBarOptions => {
  return {
    ...menuThemeOptions,
    items: [
      {
        label: `Save${isChanged.value ? '*' : ''}`,
        onClick() {
          handleSaveFile()
        },
      },
      {
        label: `Reload`,
        onClick: async () => {
          if (isChanged.value) {
            const confirmed = await confirmUnsavedChanges('Changes not saved. Continue to reload?')
            if (!confirmed) {
              return
            }
          }
          openFile()
        },
      },
      {
        label: 'Exit',
        onClick: handleExit,
      },
    ],
  }
})

function handleShortcutKey(event: KeyboardEvent) {
  const key = event.key?.toLowerCase()
  if (event.ctrlKey) {
    if (key === 's') {
      event.preventDefault()
      handleSaveFile()
    }
  }
}
</script>

<template>
  <div
    ref="wrapRef"
    v-loading="isSaving || isLoading"
    class="text-editor-wrap"
    tabindex="0"
    @keydown="handleShortcutKey"
  >
    <MenuBar :options="menuOptions" />
    <div v-if="isLoading" class="loading-wrapper">
      Loading...
    </div>
    <div v-else-if="fileTooLarge" class="too-large-state">
      <span class="mdi mdi-file-alert-outline too-large-icon" />
      <p class="too-large-title">
        File too large to edit
      </p>
      <p class="too-large-meta">
        <strong>{{ fileTooLarge.name }}</strong>
        is {{ bytesToSize(fileTooLarge.size) }} — limit is {{ bytesToSize(SIZE_LIMIT) }}
      </p>
      <div class="too-large-actions">
        <a class="vgo-button" :href="fsWebApi.getStreamUrl(absPath!)" target="_blank" rel="noopener">
          <span class="mdi mdi-open-in-new" /> Open in Browser
        </a>
      </div>
    </div>
    <textarea
      v-else
      ref="editRef"
      v-model="editContent"
      class="vgo-input font-code text-editor-textarea"
      @keydown="handleShortcutKey"
    />
  </div>
</template>

<style lang="scss" scoped>
  .text-editor-wrap {
  height: 100%;
  width: 100%;
  min-height: 200px;
  min-width: 200px;
  display: flex;
  flex-direction: column;
  padding: 2px;

  &:focus {
    outline: none;
  }

  .mx-menu-bar {
    padding: 4px 0;
    box-shadow: none;
    flex: unset;
  }

  .text-editor-textarea {
    width: 100%;
    flex: 1;
    resize: none;
  }

  .loading-wrapper {
    width: 100%;
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .too-large-state {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 32px;
    text-align: center;

    .too-large-icon {
      font-size: 52px;
      color: var(--vgo-color-warning, #e6a23c);
      opacity: 0.8;
    }

    .too-large-title {
      font-size: 16px;
      font-weight: 600;
      margin: 0;
    }

    .too-large-meta {
      font-size: 13px;
      color: var(--vgo-color-text-secondary, #888);
      margin: 0;
    }

    .too-large-actions {
      margin-top: 8px;

      .vgo-button {
        text-decoration: none;
      }
    }
  }
}
</style>
