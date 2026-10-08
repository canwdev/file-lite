import type { RouteLocationNormalized } from 'vue-router'
import { watch } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import { consumeTicket, getSession } from '@/api/session'
import { VERSION } from '@/enum/version.ts'
import { ensureSettingsStoreInitialized, settingsStore } from '@/store'
import { authSession, clearAuthSession, readAuthSession, rememberAuth, setAuthSession } from '@/store/auth'
import { setServerAllowedRoots, setServerCapabilities } from '@/store/capabilities'
import { isTerminalState, taskList } from '@/store/tasks'
import { isUnauthorizedError } from '@/utils/auth-error'
import { transferQueue } from '@/views/FileManager/ExplorerUI/transfer-queue-registry'

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
  const info = await getSession()
  setServerCapabilities(info?.capabilities)
  setServerAllowedRoots(info?.allowedRoots)
  setAuthSession(readAuthSession())
  verifiedSession = authSession.value
  warmSettingsStore()
}

/** An upload, download, or server task is still running in this page. */
function hasActiveWork() {
  if ((transferQueue.value?.activeCount.value ?? 0) > 0) {
    return true
  }
  return taskList.value.some(task => !task.debug && !isTerminalState(task.state))
}

const leaveMessage = 'An upload, download, or task is still running. Stay on this page until it finishes.'

/** One question at a time, shared by the route guard and logout. */
let leavePrompt: Promise<boolean> | null = null
/**
 * Set once the user chooses Leave, so the navigation that follows (and a
 * redirect inside it) does not ask again. Cleared when that navigation lands.
 */
let leaveGranted = false

/**
 * Refresh and close use the browser prompt. In-app route changes use the same
 * question, and closing the dialog keeps the current page.
 */
function confirmLeave(): Promise<boolean> {
  if (leavePrompt) {
    return leavePrompt
  }
  const dialog = window.$dialog
  const asking = dialog?.confirm
    ? dialog.confirm(leaveMessage, 'Work in progress', {
        type: 'warning',
        confirmButtonText: 'Stay',
        cancelButtonText: 'Leave',
        distinguishCancelAndClose: true,
      }).then(() => false, (action: unknown) => action === 'cancel')
    : Promise.resolve(window.confirm(leaveMessage))
  const pending = asking.finally(() => {
    leavePrompt = null
  })
  leavePrompt = pending
  return pending
}

/** True when this page may be left. Stay, or closing the dialog, returns false. */
export function confirmLeaveIfNeeded(): Promise<boolean> {
  if (!hasActiveWork() || leaveGranted) {
    return Promise.resolve(true)
  }
  return confirmLeave().then((leave) => {
    if (leave) {
      leaveGranted = true
    }
    return leave
  })
}

window.addEventListener('beforeunload', (event) => {
  if (!hasActiveWork()) {
    return
  }
  event.preventDefault()
  event.returnValue = ''
})

router.beforeEach(async (to, from) => {
  // The first load has no previous page. Same-path updates (ticket, navPath)
  // do not unload the file manager.
  if (from.name && to.path !== from.path && !(await confirmLeaveIfNeeded())) {
    return false
  }

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

router.afterEach((to, _from, failure) => {
  if (failure) {
    return
  }
  leaveGranted = false
  applyDocumentTitle(to)
})

watch(
  () => settingsStore.value.pageTitle,
  () => {
    applyDocumentTitle()
  },
)

export default router
