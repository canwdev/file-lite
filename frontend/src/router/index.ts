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

let verifiedAuthToken = ''

async function ensureAuthReady() {
  if (!authToken.value) {
    throw new Error('No auth token')
  }
  if (verifiedAuthToken === authToken.value) {
    return
  }
  await fsWebApi.auth()
  await ensureSettingsStoreInitialized()
  verifiedAuthToken = authToken.value
}

router.beforeEach(async (to) => {
  const query = { ...to.query }

  if (query.ticket) {
    try {
      const res = await fsWebApi.consumeTicket(String(query.ticket))
      authToken.value = res.token
      delete query.ticket
      return {
        path: to.path,
        query,
        hash: to.hash,
        replace: true,
      }
    }
    catch (error) {
      console.error(error)
      delete query.ticket
      return {
        name: 'LoginView',
        query: {
          redirect: to.path,
        },
      }
    }
  }
  if (to.meta.skipLogin) {
    if (to.name === 'LoginView' && authToken.value) {
      try {
        await ensureAuthReady()
        return { name: 'HomeView' }
      }
      catch (error) {
        console.error(error)
        authToken.value = ''
      }
    }
    return
  }
  try {
    await ensureAuthReady()
  }
  catch (error) {
    console.error(error)
    return {
      name: 'LoginView',
      query: {
        redirect: to.fullPath,
      },
    }
  }
})

router.afterEach((to) => {
  document.title = `${to.meta?.title ? `${to.meta?.title} - ` : ''}File Lite v${VERSION}`
})

export default router
