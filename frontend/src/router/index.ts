import { VERSION } from '@/enum/version.ts'
import { createRouter, createWebHistory } from 'vue-router'
import { fsWebApi } from '@/api/filesystem'
import { authToken } from '@/store'
import FileLite from '@/views/FileLite.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'HomeView',
      component: FileLite,
      meta: {},
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
        title: 'IP Chooser',
        skipLogin: true,
      },
    },
    {
      path: '/:pathMatch(.*)*',
      name: 'Page404',
      component: () => import('@/views/NotFound.vue'),
      meta: {
        title: `404`,
      },
    },
  ],
})

router.beforeEach(async (to, from, next) => {
  const query = { ...to.query }

  if (query.auth) {
    // console.log(query)
    authToken.value = query.auth as string
    delete query.auth
    return next({
      query,
    })
  }
  if (to.meta.skipLogin) {
    return next()
  }
  try {
    // throw new Error('test')
    await fsWebApi.auth()
  }
  catch (error) {
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

router.afterEach((to) => {
  document.title = `${to.meta?.title ? `${to.meta?.title} - ` : ''}File Lite v${VERSION}`
})

export default router
