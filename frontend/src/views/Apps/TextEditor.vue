<script lang="ts" setup="">
import { useUnSavedChanges } from '@canwdev/vgo-ui/src/hooks/use-beforeunload'
import { generateTextFile } from '@/views/FileManager/utils'
import { fsWebApi } from '@/api/filesystem'
import { MenuBarOptions, MenuBar } from '@imengyu/vue3-context-menu';



const props = withDefaults(
  defineProps<{
    absPath: string
  }>(),
  {},
)
const emit = defineEmits(['exit'])
const { absPath } = toRefs(props)

const editRef = ref<HTMLTextAreaElement>()
const editContent = ref('')
const { isChanged } = useUnSavedChanges()
watch(editContent, () => {
  isChanged.value = true
})

const openFile = async () => {
  console.log('open file', absPath.value)
  editContent.value = ''
  if (!absPath.value) {
    return
  }
  try {
    const res = await fsWebApi.stream(absPath.value)
    editContent.value = res as unknown as string
    setTimeout(() => {
      isChanged.value = false
    })
  } catch (error) {
    console.error('open file failed', error)
  }
}

watch(() => props.absPath, (path) => {
  absPath.value = path
  openFile()
})

onMounted(() => {
  openFile()

  setTimeout(() => {
    editRef.value?.focus()
  })
})

const handleSaveFile = async () => {
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


const menuOptions = computed((): MenuBarOptions => {
  return {
    // theme: 'flat',
    items: [
      {
        label: `Save${isChanged.value ? '*' : ''}`,
        onClick() {
          handleSaveFile()
        },
      },
      {
        label: 'Exit',
        onClick() {
          if (isChanged.value) {
            if (!confirm('Changes not save, continue to exit?')) {
              return
            }
          }
          emit('exit')
        },
      },
    ]
  }
})
</script>

<template>
  <div class="text-editor-wrap" ref="rootRef">
    <MenuBar :options="menuOptions" />
    <textarea ref="editRef" v-model="editContent" class="vgo-input font-code text-editor-textarea" />
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
  padding: 8px;
  padding-top: 0;

  .mx-menu-bar {
    padding: 4px 0;
    box-shadow: none;
    flex: unset;
  }

  .text-editor-textarea {
    width: 100%;
    flex: 1;
  }
}
</style>
