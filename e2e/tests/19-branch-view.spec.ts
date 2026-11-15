import type { Locator, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import {
  branchDir,
  html5Drag,
  login,
  openFolder,
  paste,
  readTextIfExists,
  resetBranchDirs,
  row,
} from './helpers'

/**
 * Branch view (Ctrl+B) flattens every file under the current folder into one
 * list. The files only exist in this fixture; operations must use each entry's
 * real path even when two rows share a basename.
 */

const sub1Same = path.join(branchDir, 'sub1', 'same.txt')
const sub2Same = path.join(branchDir, 'sub2', 'same.txt')
const sub1Only = path.join(branchDir, 'sub1', 'only-one.txt')

test.beforeEach(() => {
  resetBranchDirs()
})

/** Visible list row whose canonical path ends with `suffix`. */
function rowAt(page: Page, suffix: string) {
  return page.locator(`.explorer-main:visible tr[data-path$="${suffix}"]`)
}

const branchBadge = (page: Page) => page.locator('.explorer-main:visible .address-bar__branch')
const menuItems = (page: Page) => page.locator('.vgo-context-menu__item:visible')

/** Focus inside the pane so panel shortcuts (Ctrl+B) resolve their scope. */
async function focusList(page: Page) {
  await page.evaluate(() => {
    const wraps = Array.from(document.querySelectorAll<HTMLElement>('.explorer-list-wrap'))
    wraps.find(el => el.getClientRects().length > 0)?.focus()
  })
}

async function enableBranchView(page: Page) {
  await focusList(page)
  await page.keyboard.press('Control+b')
  await expect(branchBadge(page)).toBeVisible()
  await expect(rowAt(page, '/branch/sub1/same.txt')).toBeVisible()
}

async function openSelectionMore(page: Page, target: Locator) {
  await target.click({ button: 'right' })
  await menuItems(page).filter({ hasText: /^More$/ }).last().hover()
  return menuItems(page)
}

async function clickMenuItem(page: Page, label: RegExp) {
  await menuItems(page).filter({ hasText: label }).last().click()
}

test.describe('branch view', () => {
  test('Ctrl+B flattens subfolders and the address-bar badge exits', async ({ page }) => {
    await login(page)
    await openFolder(page, 'branch')
    await expect(rowAt(page, '/branch/a.txt')).toBeVisible()
    await expect(row(page, 'sub1')).toBeVisible()
    await expect(row(page, 'sub2')).toBeVisible()

    await enableBranchView(page)

    await expect(rowAt(page, '/branch/a.txt')).toBeVisible()
    await expect(rowAt(page, '/branch/sub1/same.txt')).toBeVisible()
    await expect(rowAt(page, '/branch/sub2/same.txt')).toBeVisible()
    await expect(rowAt(page, '/branch/sub1/only-one.txt')).toBeVisible()
    await expect(rowAt(page, '/branch/sub1/deeper/deep.txt')).toBeVisible()
    // Directories themselves are not flattened into the list.
    await expect(row(page, 'sub1')).toHaveCount(0)

    await expect(branchBadge(page)).toContainText('Branch view')
    // The badge uses the close (X) icon, so it reads as a way out of the mode.
    await expect(branchBadge(page).locator('svg')).toHaveCount(1)
    await branchBadge(page).click()

    await expect(branchBadge(page)).toBeHidden()
    await expect(row(page, 'sub1')).toBeVisible()
    await expect(rowAt(page, '/branch/sub1/same.txt')).toHaveCount(0)
  })

  test('More and Ctrl+B flatten only the selected files and folders', async ({ page }) => {
    await login(page)
    await openFolder(page, 'branch')

    // Single file: Branch view sits directly below Batch Rename and shows the
    // panel shortcut.
    const items = await openSelectionMore(page, row(page, 'a.txt'))
    await expect(items.filter({ hasText: /^Branch view/ }).last()).toBeVisible()
    const labels = (await items.allInnerTexts()).map(text => text.trim())
    const batchIndex = labels.indexOf('Batch Rename')
    expect(batchIndex).toBeGreaterThanOrEqual(0)
    expect(labels.findIndex(text => text.startsWith('Branch view'))).toBe(batchIndex + 1)
    const branchItem = items.filter({ hasText: /^Branch view/ }).last()
    await expect(branchItem).toContainText('Ctrl+B')
    await branchItem.click()

    await expect(branchBadge(page)).toBeVisible()
    await expect(rowAt(page, '/branch/a.txt')).toBeVisible()
    // The rest of the current folder is filtered out.
    await expect(rowAt(page, '/branch/sub1/same.txt')).toHaveCount(0)
    await expect(rowAt(page, '/branch/sub2/same.txt')).toHaveCount(0)

    // The badge leaves the selection-scoped view and restores the folder.
    await branchBadge(page).click()
    await expect(row(page, 'sub1')).toBeVisible()

    // Folder selection through Ctrl+B: only that folder's subtree is shown.
    await row(page, 'sub1').click()
    await focusList(page)
    await page.keyboard.press('Control+b')
    await expect(branchBadge(page)).toBeVisible()
    await expect(rowAt(page, '/branch/sub1/same.txt')).toBeVisible()
    await expect(rowAt(page, '/branch/sub1/only-one.txt')).toBeVisible()
    await expect(rowAt(page, '/branch/sub1/deeper/deep.txt')).toBeVisible()
    await expect(rowAt(page, '/branch/a.txt')).toHaveCount(0)
    await expect(rowAt(page, '/branch/sub2/same.txt')).toHaveCount(0)

    await branchBadge(page).click()
    await expect(row(page, 'a.txt')).toBeVisible()

    // File + folder selection: the union of the file and the folder subtree.
    await row(page, 'sub1').click()
    await row(page, 'a.txt').click({ modifiers: ['Control'] })
    await expect(page.locator('.explorer-main:visible tr.is-active')).toHaveCount(2)
    await focusList(page)
    await page.keyboard.press('Control+b')
    await expect(branchBadge(page)).toBeVisible()
    await expect(rowAt(page, '/branch/a.txt')).toBeVisible()
    await expect(rowAt(page, '/branch/sub1/same.txt')).toBeVisible()
    await expect(rowAt(page, '/branch/sub1/only-one.txt')).toBeVisible()
    await expect(rowAt(page, '/branch/sub1/deeper/deep.txt')).toBeVisible()
    await expect(rowAt(page, '/branch/sub2/same.txt')).toHaveCount(0)

    await branchBadge(page).click()
    await expect(row(page, 'sub2')).toBeVisible()
  })

  test('cut dims only the nested file and paste moves that file', async ({ page }) => {
    await login(page)
    await openFolder(page, 'branch')
    await enableBranchView(page)

    await rowAt(page, '/branch/sub1/same.txt').click({ button: 'right' })
    await clickMenuItem(page, /^Cut/)
    await expect(rowAt(page, '/branch/sub1/same.txt')).toHaveClass(/is-cut/)
    await expect(rowAt(page, '/branch/sub2/same.txt')).not.toHaveClass(/is-cut/)

    await paste(page)

    await expect.poll(() => readTextIfExists(path.join(branchDir, 'same.txt'))).toBe('sub1-same')
    await expect.poll(() => fs.existsSync(sub1Same)).toBe(false)
    expect(fs.readFileSync(sub2Same, 'utf8')).toBe('sub2-same')

    await expect(rowAt(page, '/branch/same.txt')).toBeVisible()
    await expect(rowAt(page, '/branch/sub1/same.txt')).toHaveCount(0)
    await expect(rowAt(page, '/branch/sub2/same.txt')).toBeVisible()
  })

  test('dragging a nested file to the current folder moves or copies it', async ({ page }) => {
    await login(page)
    await openFolder(page, 'branch')
    await enableBranchView(page)
    const crumb = page.locator('.address-bar__crumb', { hasText: 'branch' }).last()

    await html5Drag(page, rowAt(page, '/branch/sub1/only-one.txt'), crumb)
    await expect.poll(() => readTextIfExists(path.join(branchDir, 'only-one.txt'))).toBe('only-one')
    await expect.poll(() => fs.existsSync(sub1Only)).toBe(false)

    await html5Drag(page, rowAt(page, '/branch/sub2/same.txt'), crumb, { ctrlKey: true })
    await expect.poll(() => readTextIfExists(path.join(branchDir, 'same.txt'))).toBe('sub2-same')
    expect(fs.readFileSync(sub2Same, 'utf8')).toBe('sub2-same')
    await expect(rowAt(page, '/branch/same.txt')).toBeVisible()
    await expect(rowAt(page, '/branch/sub2/same.txt')).toBeVisible()
  })

  test('duplicate basenames keep exact selection ranges and refresh', async ({ page }) => {
    await login(page)
    await openFolder(page, 'branch')
    await enableBranchView(page)

    const active = page.locator('.explorer-main:visible tr.is-active')
    await rowAt(page, '/branch/a.txt').click()
    // Visible order: a.txt, deep.txt, only-one.txt, sub1/same.txt, sub2/same.txt.
    // A name-based range would stop at the first same.txt and select only four.
    await rowAt(page, '/branch/sub2/same.txt').click({ modifiers: ['Shift'] })
    await expect(active).toHaveCount(5)

    await rowAt(page, '/branch/sub1/same.txt').click()
    await expect(active).toHaveCount(1)
    // A same-directory refresh must reconcile by path, not select both same.txt.
    await Promise.all([
      page.waitForResponse(response => response.url().includes('/api/fs/directories/')),
      page.locator('.explorer-main:visible button[title^="Refresh"]').click(),
    ])
    await expect(active).toHaveCount(1)
    await expect(rowAt(page, '/branch/sub1/same.txt')).toHaveClass(/is-active/)
    await expect(rowAt(page, '/branch/sub2/same.txt')).not.toHaveClass(/is-active/)
  })

  test('opening a flattened file uses its real path', async ({ page }) => {
    await login(page)
    await openFolder(page, 'branch')
    await enableBranchView(page)

    await rowAt(page, '/branch/sub1/deeper/deep.txt').dblclick()
    const win = page.locator('.app-window')
    // Branch rows are named by their relative path, so the editor title keeps it.
    await expect(win.locator('.title-text')).toHaveText('sub1/deeper/deep.txt')
    await expect(win.locator('.text-editor-textarea')).toHaveValue('deep')
    await win.locator('.title-icon').dblclick()
    await expect(win).toBeHidden()
  })

  test('delete confirmation distinguishes same-named files by relative path', async ({ page }) => {
    await login(page)
    await openFolder(page, 'branch')
    await enableBranchView(page)

    await rowAt(page, '/branch/sub1/same.txt').click()
    await rowAt(page, '/branch/sub2/same.txt').click({ modifiers: ['Control'] })
    await rowAt(page, '/branch/sub1/same.txt').click({ button: 'right' })
    await clickMenuItem(page, /^Delete/)

    const box = page.locator('.el-message-box')
    await expect(box).toBeVisible()
    await expect(box).toContainText('sub1/same.txt')
    await expect(box).toContainText('sub2/same.txt')
    await box.getByRole('button', { name: 'Cancel' }).click()
    await expect(box).toBeHidden()
    expect(fs.readFileSync(sub1Same, 'utf8')).toBe('sub1-same')
    expect(fs.readFileSync(sub2Same, 'utf8')).toBe('sub2-same')
  })
})
