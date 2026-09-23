import type { MenuOptions } from '@canwdev/vgo-ui'

/**
 * Options shared by every context menu in the app.
 *
 * `closeWhenScroll: false` keeps a menu open while the page (e.g. the file list)
 * scrolls. Scrolling inside an overflowed menu still works: vgo-ui scrolls the
 * menu natively and only closes when the scroll happens outside the menu.
 */
export const baseContextMenuOptions = {
  closeWhenScroll: false,
} as const satisfies Partial<MenuOptions>
