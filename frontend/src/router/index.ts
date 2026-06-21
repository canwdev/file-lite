import { createRouter, createWebHistory } from 'vue-router'
import { fsWebApi } from '@/api/filesystem'
import { VERSION } from '@/enum/version.ts'
import { ensureSettingsStoreInitialized } from '@/store'
import { authToken } from '@/store/auth'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'HomeView',
      component: () => import('@/views/FileLite.vue'),
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

  if (query.ticket) {
    try {
      const res = await fsWebApi.consumeTicket(String(query.ticket))
      authToken.value = res.token
      delete query.ticket
      return next({
        path: to.path,
        query,
        hash: to.hash,
        replace: true,
      })
    }
    catch (error) {
      console.error(error)
      delete query.ticket
      return next({
        name: 'LoginView',
        query: {
          redirect: to.path,
        },
      })
    }
  }
  if (to.meta.skipLogin) {
    return next()
  }
  try {
    await fsWebApi.auth()
    await ensureSettingsStoreInitialized()
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
