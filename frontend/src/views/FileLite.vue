<script lang="ts" setup>
import { authToken } from '@/store'
import FileManager from '@/views/FileManager/FileManager.vue'
import Login from '@/views/Login.vue'
import AppsEntry from './Apps/AppsEntry.vue';
</script>

<template>
  <Login v-if="!authToken" />
  <FileManager v-else />
  <AppsEntry />
</template>
