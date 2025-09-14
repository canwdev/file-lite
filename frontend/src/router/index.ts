import {createRouter, createWebHistory} from 'vue-router'
import FileLite from '@/views/FileLite.vue'
import {authToken} from '@/store'

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

router.beforeEach(async (to, from, next) => {
  const query = {...to.query}

  if (query.auth) {
    console.log(query)
    authToken.value = query.auth as string
    delete query.auth
    return next({
      query: query,
    })
  }
  return next()
})

export default router
