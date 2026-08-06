import ContextMenu from '@imengyu/vue3-context-menu'
import { createPinia } from 'pinia'

import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'
import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import '@canwdev/vgo-ui/styles/core'
import '@canwdev/vgo-ui/themes/default'
import './styles/style.scss'
import 'element-plus/dist/index.css'

import 'element-plus/theme-chalk/dark/css-vars.css'
// https://pictogrammers.com/library/mdi/
import '@mdi/font/css/materialdesignicons.min.css'

import 'normalize.css'
import '@imengyu/vue3-context-menu/lib/vue3-context-menu.css'

async function bootstrap() {
  const app = createApp(App)

  const pinia = createPinia()
  pinia.use(piniaPluginPersistedstate)
  app.use(pinia)

  app.use(router)
  app.use(ContextMenu)

  app.mount('#app')
  window.__APP_READY__ = true
}

bootstrap()
