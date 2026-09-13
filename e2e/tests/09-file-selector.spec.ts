import { expect, test } from '@playwright/test'
import { login, openFolder, row } from './helpers'

/**
 * 选择器模式（FileSelector）。
 *
 * 多标签只作用于主界面：选择器窗口必须仍然是「单面板、没有标签栏」，并且选中后能正常返回。
 * 入口在视频播放器的设置菜单里，所以夹具放了一个 clip.mp4 占位文件。
 */
test('选择器窗口是单面板、没有标签栏，选中后能返回', async ({ page }) => {
  await login(page)
  await openFolder(page, 'source')
  await row(page, 'clip.mp4').dblclick()

  // 视频走 Artplayer：悬停出控制栏，设置菜单里有「Open server video…」
  const player = page.locator('.art-video-player').first()
  await expect(player).toBeVisible()
  await player.hover()
  await page.locator('.art-auto-playback-close').click({ timeout: 2000 }).catch(() => {})
  await page.locator('.art-control-setting').click()
  await page.locator('.art-setting-item', { hasText: 'Open server video' }).click()

  const footer = page.locator('.explorer-bottom-wrap')
  await expect(footer).toBeVisible()
  const picker = page.locator('.vgo-window').filter({ has: footer }).first()
  await expect(picker).toBeVisible()

  // 选择器里没有标签栏，且只有一个面板；主界面那条标签栏不受影响
  await expect(picker.locator('.explorer-tabs')).toHaveCount(0)
  await expect(picker.locator('.explorer-main')).toHaveCount(1)
  await expect(page.locator('.explorer-tabs')).toHaveCount(1)

  // 选中一个文件并 Open：选择器关闭（FileManager 会保持挂载，所以看窗口是否隐藏）
  await picker.locator('tr[data-name="clip.mp4"]').click()
  await footer.getByRole('button', { name: 'Open' }).click()
  await expect(footer).toBeHidden()
})
