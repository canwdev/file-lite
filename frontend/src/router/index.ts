import {createRouter, createWebHistory} from 'vue-router'
import FileLite from '@/views/FileLite.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'FileLite',
      component: FileLite,
      meta: {
        title: `FileLite`,
      },
    },
  ],
})

export default router
