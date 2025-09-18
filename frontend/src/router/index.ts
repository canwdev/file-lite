import {createRouter, createWebHistory} from 'vue-router'
import FileLite from '@/views/FileLite.vue'
import {authToken} from '@/store'
import {fsWebApi} from '@/api/filesystem'

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
      path: '/login',
      name: 'LoginView',
      component: () => import('@/views/Login.vue'),
      meta: {
        title: 'Login',
        skipLogin: true,
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
  if (to.meta.skipLogin) {
    return next()
  }
  try {
    // throw new Error('test')
    await fsWebApi.auth()
  } catch (error) {
    console.error(error)
    return next({
      name: 'LoginView',
      query: {
        redirect: to.fullPath,
      },
    })
  }
  return next()
})

export default router
