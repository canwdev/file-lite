import {createRouter, createWebHistory} from 'vue-router'
import FileLite from '@/views/FileLite.vue'
import {authToken} from '@/store'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'HomeView',
      component: FileLite,
      meta: {
        title: `FileLite`,
      },
    },
    {
      path: '/ip',
      name: 'IpChooserView',
      component: () => import('@/views/IpChooser.vue'),
      meta: {
        title: 'IP Address',
        skipLogin: true,
      },
    },
    // 404
    {
      path: '/:pathMatch(.*)*',
      name: '404',
      component: () => import('@/views/NotFound.vue'),
      meta: {
        title: `404`,
      },
    },
  ],
})

router.beforeEach(async (to, from, next) => {
  const query = {...to.query}

  if (query.auth) {
    // console.log(query)
    authToken.value = query.auth as string
    delete query.auth
    return next({
      query: query,
    })
  }
  return next()
})

export default router
