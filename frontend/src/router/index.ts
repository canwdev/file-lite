import type { RouteLocationNormalized } from 'vue-router'
import { watch } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import { consumeTicket, getAuthInfo } from '@/api/auth'
import { VERSION } from '@/enum/version.ts'
import { ensureSettingsStoreInitialized, settingsStore } from '@/store'
import { authSession, clearAuthSession, readAuthSession, rememberAuth, setAuthSession } from '@/store/auth'
import { setServerAllowedRoots, setServerCapabilities } from '@/store/capabilities'
import { isUnauthorizedError } from '@/utils/auth-error'

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

let verifiedSession = ''

function warmSettingsStore() {
  void ensureSettingsStoreInitialized().catch((error) => {
    console.error(error)
  })
}

/**
 * Probe the session. The token is an HttpOnly cookie, so nothing can be checked
 * locally: ask the backend and mirror the readable session cookie. A 401 is
 * surfaced by the service interceptor, which sends the app back to the login.
 */
async function ensureAuthReady() {
  if (authSession.value && verifiedSession === authSession.value) {
    warmSettingsStore()
    return
  }
  const info = await getAuthInfo()
  setServerCapabilities(info?.capabilities)
  setServerAllowedRoots(info?.allowedRoots)
  setAuthSession(readAuthSession())
  verifiedSession = authSession.value
  warmSettingsStore()
}

router.beforeEach(async (to) => {
  const query = { ...to.query }

  if (query.ticket) {
    try {
      await consumeTicket(String(query.ticket), rememberAuth.value)
      setAuthSession(readAuthSession())
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
    if (to.name === 'LoginView' && authSession.value) {
      try {
        await ensureAuthReady()
        return { name: 'HomeView' }
      }
      catch (error) {
        console.error(error)
        if (isUnauthorizedError(error)) {
          clearAuthSession()
        }
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

/** 原始标题：`[Route Title - ]File Lite v{VERSION}` */
export function getBaseDocumentTitle(route: RouteLocationNormalized = router.currentRoute.value) {
  const routeTitle = typeof route.meta?.title === 'string' ? route.meta.title : ''
  return `${routeTitle ? `${routeTitle} - ` : ''}File Lite v${VERSION}`
}

export function applyDocumentTitle(route: RouteLocationNormalized = router.currentRoute.value) {
  const base = getBaseDocumentTitle(route)
  const custom = settingsStore.value.pageTitle.trim()
  document.title = custom ? `${custom} - ${base}` : base
}

router.afterEach((to) => {
  applyDocumentTitle(to)
})

watch(
  () => settingsStore.value.pageTitle,
  () => {
    applyDocumentTitle()
  },
)

export default router
