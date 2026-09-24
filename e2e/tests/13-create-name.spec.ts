import { expect, test } from '@playwright/test'
import { login, openFolder } from './helpers'

/**
 * Create File / Create Folder select the suggested name so it can be typed over.
 */
test.describe('create name', () => {
  test('create file and folder select the suggested name', async ({ page }) => {
    await login(page)
    await openFolder(page, 'empty')

    await page.locator('.explorer-main:visible button[title="Create Document"]').click()
    const fileBox = page.locator('.el-message-box')
    const fileName = fileBox.locator('input')
    await expect(fileName).toBeFocused()
    await expect.poll(() => fileName.evaluate((el) => {
      const input = el as HTMLInputElement
      return input.selectionStart === 0
        && input.selectionEnd === input.value.length
        && input.value.endsWith('.txt')
    })).toBe(true)
    await fileBox.getByRole('button', { name: 'Cancel' }).click()
    await expect(fileBox).toBeHidden()

    await page.locator('.explorer-main:visible button[title="Create Folder"]').click()
    const folderBox = page.locator('.el-message-box')
    const folderName = folderBox.locator('input')
    await expect(folderName).toBeFocused()
    await expect.poll(() => folderName.evaluate((el) => {
      const input = el as HTMLInputElement
      return input.selectionStart === 0
        && input.selectionEnd === input.value.length
        && !input.value.includes('.')
    })).toBe(true)
    await folderBox.getByRole('button', { name: 'Cancel' }).click()
  })
})
