import fs from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import {
  emptyDir,
  login,
  openFolder,
  readTextIfExists,
  row,
} from './helpers'

/**
 * 7-Zip menu: compress into the current folder and extract back.
 * The suite skips when this machine has no 7z binary — the menu is absent then.
 */
test.describe('7-Zip', () => {
  test.beforeEach(async ({ page }) => {
    fs.mkdirSync(emptyDir, { recursive: true })
    for (const name of fs.readdirSync(emptyDir)) {
      fs.rmSync(path.join(emptyDir, name), { recursive: true, force: true })
    }
    await login(page)
  })

  test('compresses a file to ZIP and extracts it here', async ({ page }) => {
    fs.writeFileSync(path.join(emptyDir, 'plain.txt'), 'hello-archive')
    await openFolder(page, 'empty')
    if (!await openSevenZip(page, 'plain.txt'))
      test.skip()

    await page.locator('.vgo-context-menu__label', { hasText: 'Compress...' }).click()
    const box = page.locator('.el-message-box')
    const name = box.locator('.el-input__inner').first()
    await expect(name).toHaveValue('plain')
    await expect(name).toBeFocused()
    await expect.poll(() => name.evaluate((el) => {
      const input = el as HTMLInputElement
      return input.selectionStart === 0 && input.selectionEnd === input.value.length
    })).toBe(true)
    await box.getByRole('button', { name: 'Compress' }).click()

    const zipPath = path.join(emptyDir, 'plain.zip')
    await expect.poll(() => fs.existsSync(zipPath)).toBe(true)
    await expect(row(page, 'plain.zip')).toBeVisible()

    fs.rmSync(path.join(emptyDir, 'plain.txt'))
    if (!await openSevenZip(page, 'plain.zip'))
      test.skip()
    await page.locator('.vgo-context-menu__label', { hasText: 'Extract...' }).click()
    await page.locator('.el-message-box').getByRole('button', { name: 'Extract' }).click()

    await expect.poll(() => readTextIfExists(path.join(emptyDir, 'plain.txt'))).toBe('hello-archive')
    await expect(row(page, 'plain.txt')).toBeVisible()
  })

  test('a wrong extract password fails and does not write the file', async ({ page }) => {
    fs.writeFileSync(path.join(emptyDir, 'secret.txt'), 'hidden')
    await openFolder(page, 'empty')
    if (!await openSevenZip(page, 'secret.txt'))
      test.skip()

    await page.locator('.vgo-context-menu__label', { hasText: 'Compress...' }).click()
    const box = page.locator('.el-message-box')
    await expect(box.locator('.el-input__inner').first()).toHaveValue('secret')
    await box.locator('input[type="password"]').fill('s3cret')
    await box.getByRole('button', { name: 'Compress' }).click()
    await expect.poll(() => fs.existsSync(path.join(emptyDir, 'secret.zip'))).toBe(true)

    fs.rmSync(path.join(emptyDir, 'secret.txt'))
    if (!await openSevenZip(page, 'secret.zip'))
      test.skip()
    await page.locator('.vgo-context-menu__label', { hasText: 'Extract...' }).click()
    const extractBox = page.locator('.el-message-box')
    await extractBox.locator('input[type="password"]').fill('nope')
    await extractBox.getByRole('button', { name: 'Extract' }).click()

    await expect(page.locator('.failure-dialog')).toContainText('Wrong password')
    expect(fs.existsSync(path.join(emptyDir, 'secret.txt'))).toBe(false)
  })

  test('compresses each selected file with a prefix', async ({ page }) => {
    fs.writeFileSync(path.join(emptyDir, 'a.txt'), 'aaa')
    fs.writeFileSync(path.join(emptyDir, 'b.txt'), 'bbb')
    await openFolder(page, 'empty')
    await row(page, 'a.txt').click()
    await row(page, 'b.txt').click({ modifiers: ['Control'] })
    if (!await openSevenZip(page, 'b.txt'))
      test.skip()

    await page.locator('.vgo-context-menu__label', { hasText: 'Compress...' }).click()
    const box = page.locator('.el-message-box')
    const name = box.locator('.el-input__inner').first()
    await expect(name).toHaveValue(/^empty-\d{12}$/)
    await box.getByText('Compress separately', { exact: true }).click()
    await expect(name).toHaveValue('')
    await name.fill('pre-')
    await box.getByRole('button', { name: 'Compress' }).click()

    await expect.poll(() => fs.existsSync(path.join(emptyDir, 'pre-a.zip'))).toBe(true)
    await expect.poll(() => fs.existsSync(path.join(emptyDir, 'pre-b.zip'))).toBe(true)
  })
})

async function openSevenZip(page: import('@playwright/test').Page, name: string) {
  await row(page, name).click({ button: 'right' })
  const item = page.locator('.vgo-context-menu__item', { hasText: '7-Zip' }).last()
  if (await item.count() === 0)
    return false
  await item.hover()
  await expect(page.locator('.vgo-context-menu__label', { hasText: 'Compress...' })).toBeVisible()
  return true
}
