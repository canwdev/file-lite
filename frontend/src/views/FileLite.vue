<script lang="ts" setup>
import {authToken} from '@/store'
import {fsWebApi} from '@/api/filesystem.ts'
const route = useRoute()
const router = useRouter()
onMounted(() => {
  console.log(route.query)
  if (route.query.auth) {
    authToken.value = route.query.auth as string
    router.replace({query: {}})
  }
})

onMounted(async () => {
  await fsWebApi.getDrives()
})
</script>

<template>
  <div class="file-lite">
    <input type="text" v-model="authToken" />
  </div>
</template>

<style lang="scss" scoped>
.file-lite {
}
</style>
