<script lang="ts" setup>
import { useFileLiteMenu } from '@/views/Apps/use-file-lite-menu.ts'
import FileManager from '@/views/FileManager/FileManager.vue'
import AppsEntry from './Apps/AppsEntry.vue'

const { showMenu } = useFileLiteMenu()
</script>

<template>
  <FileManager>
    <template #headerRight>
      <button
        class="vgo-button vgo-button--text vgo-button--icon vgo-button--md"
        title="Menu"
        @click="showMenu"
      >
        <span class="mdi mdi-menu" />
      </button>
    </template>
  </FileManager>
  <AppsEntry />
</template>
