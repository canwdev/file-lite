import {createApp} from 'vue'
import App from './App.vue'
import router from './router'

import './styles/style.scss'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import 'element-plus/theme-chalk/dark/css-vars.css'
// https://pictogrammers.com/library/mdi/
import '@mdi/font/css/materialdesignicons.min.css'
import 'normalize.css'
const app = createApp(App)

app.use(router)
app.use(ElementPlus)

app.mount('#app')
