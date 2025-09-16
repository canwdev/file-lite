<script lang="ts" setup="">
import { QuickOptionItem } from '@canwdev/vgo-ui/src/components/QuickOptions/enum'
import { useUnSavedChanges } from '@canwdev/vgo-ui/src/hooks/use-beforeunload'
import { generateTextFile } from '@/views/FileManager/utils'
import { fsWebApi } from '@/api/filesystem'
import QuickMenuStrip from '@canwdev/vgo-ui/src/components/QuickOptions/QuickMenuStrip.vue'


const props = withDefaults(
  defineProps<{
    absPath: string
  }>(),
  {},
)
const emit = defineEmits(['exit'])
const { absPath } = toRefs(props)

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


const menuOptions = computed((): QuickOptionItem[] => {
  return [
    {
      label: `Save ${isChanged.value ? '*' : ''}`,
      props: {
        onClick() {
          handleSaveFile()
        },
      },
    },

    { split: true },

    {
      label: 'Exit',
      props: {
        onClick() {
          if (isChanged.value) {
            if (!confirm('Changes not save, continue to exit?')) {
              return
            }
          }
          emit('exit')
        },
      },
    },
  ]
})
</script>

<template>
  <div class="text-editor-wrap" ref="rootRef">
    <QuickMenuStrip :options="menuOptions" />
    <textarea v-model="editContent" class="vgo-input font-code text-editor-textarea" />
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

  .quick-menu-strip {
    border-bottom: 0;
  }

  .text-editor-textarea {
    width: 100%;
    flex: 1;
  }
}
</style>
