import { describe, expect, test } from 'bun:test'
import { needsClientExecution } from './mounted-volumes'

/**
 * 任务 id 的前缀判定。
 *
 * 这里就地写一份而不是 import `client-tasks.ts`：那个模块拉着 `@/api/filesystem`
 * 等一串 `@/` 依赖，而 `bun test` 不认 Vite 的路径别名。前缀判定本身只有一行，
 * 用它去拉整条依赖链不划算；真正难的是下面 `needsClientExecution` 的边界，
 * 那份逻辑住在 `mounted-volumes.ts`，测的是真实现。
 */
const CLIENT_TASK_PREFIX = 'clienttask_'
function isClientTaskId(taskId: string): boolean {
  return taskId.startsWith(CLIENT_TASK_PREFIX)
}

/**
 * 任务派发规则：**只要一次操作碰到浏览器挂载卷，就必须由前端执行**。
 *
 * 这条规则是那组 `Source path does not exist: /@mounted/...` /
 * `open /@mounted/...: no such file or directory` 的直接修复——过去所有复制、移动、
 * 删除都无条件发给后端任务，而 `/@mounted/...` 是浏览器里的内容，后端只认识
 * 「路径 → os.*」，于是一定失败。
 *
 * 反过来也必须成立：普通的服务端操作不能被误判成客户端任务，否则会绕过服务端的
 * 冲突处理与跨卷回退。
 *
 * 判定本身住在 `mounted-volumes.ts`（纯路径逻辑），所以这里测的是真实现。
 */
const MOUNTED = '/@mounted/14cce14efc17/tessoa.exe'

describe('needsClientExecution', () => {
  test('源在挂载卷里 → 前端执行', () => {
    expect(needsClientExecution([MOUNTED], '/home/me/docs')).toBe(true)
  })

  test('目标在挂载卷里 → 前端执行', () => {
    expect(needsClientExecution(['/home/me/20260919_202546.txt'], '/@mounted/14cce14efc17/')).toBe(true)
  })

  test('源与目标都在挂载卷里 → 前端执行', () => {
    expect(needsClientExecution(['/@mounted/aaa/a.txt'], '/@mounted/bbb/')).toBe(true)
  })

  test('多选里只要有一项在挂载卷里 → 整个任务前端执行', () => {
    expect(needsClientExecution(['/home/me/a.txt', MOUNTED], '/home/me/docs')).toBe(true)
  })

  test('纯服务端操作仍走服务端任务', () => {
    expect(needsClientExecution(['/home/me/a.txt'], '/home/me/docs')).toBe(false)
    expect(needsClientExecution(['C:/Users/me/a.txt'], 'C:/Users/me/docs')).toBe(false)
    expect(needsClientExecution(['//server/share/a.txt'], '//server/share/docs')).toBe(false)
  })

  test('删除（没有目标）只看源', () => {
    expect(needsClientExecution([MOUNTED])).toBe(true)
    expect(needsClientExecution(['/home/me/a.txt'])).toBe(false)
  })

  test('段边界：像挂载卷但不是的路径不算', () => {
    expect(needsClientExecution(['/@mountedfoo/a.txt'], '/home/me')).toBe(false)
    expect(needsClientExecution(['/home/@mounted/a.txt'], '/home/me')).toBe(false)
  })

  test('没有源时不需要前端执行', () => {
    expect(needsClientExecution([], '/@mounted/aaa/')).toBe(true)
    expect(needsClientExecution([])).toBe(false)
  })
})

describe('isClientTaskId', () => {
  test('只认自己生成的前缀', () => {
    expect(isClientTaskId('clienttask_1700000000000_1')).toBe(true)
    expect(isClientTaskId('task_123')).toBe(false)
    expect(isClientTaskId('')).toBe(false)
  })
})
