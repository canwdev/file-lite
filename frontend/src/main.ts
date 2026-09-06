import ContextMenu from '@imengyu/vue3-context-menu'
import { createPinia } from 'pinia'

import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'
import { createApp } from 'vue'
import MdiIcon from '@/components/MdiIcon.vue'
import App from './App.vue'
import router from './router'
import '@canwdev/vgo-ui/styles/core'
import '@canwdev/vgo-ui/themes/default'
import './styles/style.scss'

// Element Plus 样式按需加载：模板中的 <el-*> 组件样式由 unplugin-vue-components
// 的 ElementPlusResolver 自动注入（含 base 变量），这里只保留非模板场景需要的：
// 编程式 ElMessage/ElMessageBox 与 v-loading 指令的样式，以及暗色主题变量。
import 'element-plus/theme-chalk/dark/css-vars.css'
import 'element-plus/es/components/message/style/css'
import 'element-plus/es/components/message-box/style/css'
import 'element-plus/es/components/loading/style/css'

import 'normalize.css'
import '@imengyu/vue3-context-menu/lib/vue3-context-menu.css'

async function bootstrap() {
  const app = createApp(App)

  const pinia = createPinia()
  pinia.use(piniaPluginPersistedstate)
  app.use(pinia)

  app.use(router)
  app.use(ContextMenu)
  app.component('MdiIcon', MdiIcon)

  app.mount('#app')
  window.__APP_READY__ = true
}

bootstrap()
