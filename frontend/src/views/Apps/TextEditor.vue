<script lang="ts" setup="">
import type { MenuBarOptions } from '@canwdev/vgo-ui'
import type { AppParams } from '@/views/Apps/apps.ts'
import { ContextMenuBar, useUnSavedChanges } from '@canwdev/vgo-ui'
import { injectShortcutScope, useShortcut } from '@/hooks/use-shortcut'
import { bytesToSize } from '@/utils'
import { baseContextMenuOptions } from '@/utils/context-menu'
import { fs } from '@/utils/fs'

const props = withDefaults(
  defineProps<{
    appParams: AppParams
  }>(),
  {},
)

const emit = defineEmits(['exit', 'setTitle'])
const shortcutScope = injectShortcutScope()

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

function isAbortError(error: unknown) {
  if (typeof error !== 'object' || error === null) {
    return false
  }
  const { name, code } = error as { name?: string, code?: string }
  return name === 'AbortError' || name === 'CanceledError' || code === 'ERR_CANCELED'
}

// 切换文件时旧请求可能后返回，用 AbortController 让它在途取消，避免旧内容覆盖新文件
let openController: AbortController | null = null

async function openFile() {
  openController?.abort()
  const controller = new AbortController()
  openController = controller

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

    // 走门面读取文本
    const text = await fs.readText(absPath.value, { signal: controller.signal })
    if (controller.signal.aborted) {
      return
    }
    editContent.value = text
    setTimeout(() => {
      isChanged.value = false
    })
  }
  catch (error) {
    if (!isAbortError(error)) {
      console.error('open file failed', error)
    }
  }
  finally {
    // 已被更新的请求取代时不要回写 loading / 抢焦点
    if (openController === controller) {
      openController = null
      isLoading.value = false
      if (!controller.signal.aborted) {
        await focusEditor()
      }
    }
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
})

onBeforeUnmount(() => {
  openController?.abort()
})

/** 某个路径的父目录 */
function dirOf(path: string) {
  const cut = path.replace(/\/+$/, '').lastIndexOf('/')
  return cut > 0 ? path.slice(0, cut) : path
}

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
    // 保存就是覆盖打开的这个文件，所以显式 overwrite；门面负责分派与只读守卫。
    const written = await fs.writeText(dirOf(absPath.value), filename, editContent.value, {
      conflict: 'overwrite',
    })
    if (!written.ok) {
      window.$message?.warning(written.reason ?? 'This location is read-only')
      return
    }
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
    ...baseContextMenuOptions,
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

useShortcut({
  scope: shortcutScope,
  combo: ['ctrl+s', 'meta+s'],
  description: 'Save',
  handler: handleSaveFile,
  allowInInput: true,
})
</script>

<template>
  <div
    ref="wrapRef"
    v-loading="isSaving || isLoading"
    class="text-editor-wrap"
    tabindex="0"
  >
    <ContextMenuBar :options="menuOptions" />
    <div v-if="isLoading" class="loading-wrapper">
      Loading...
    </div>
    <div v-else-if="fileTooLarge" class="vgo-empty too-large-state">
      <span class="vgo-empty__icon too-large-icon">
        <i-mdi-file-alert-outline />
      </span>
      <p class="vgo-empty__title">
        File too large to edit
      </p>
      <p class="vgo-empty__desc">
        <strong>{{ fileTooLarge.name }}</strong>
        is {{ bytesToSize(fileTooLarge.size) }} — limit is {{ bytesToSize(SIZE_LIMIT) }}
      </p>
      <a class="vgo-button" :href="fs.url(absPath!)" target="_blank" rel="noopener">
        <i-mdi-open-in-new /> Open in Browser
      </a>
    </div>
    <textarea
      v-else
      ref="editRef"
      v-model="editContent"
      class="vgo-input vgo-u-font-code text-editor-textarea"
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

  .vgo-context-menu-bar {
    padding: var(--vgo-space-1) 0;
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

    p {
      margin: 0;
    }

    .too-large-icon {
      color: var(--vgo-warning);
      opacity: 1;
    }

    .vgo-button {
      text-decoration: none;
    }
  }
}
</style>
