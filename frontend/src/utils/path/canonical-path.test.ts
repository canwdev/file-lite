import { describe, expect, test } from 'bun:test'
import { canonicalizePath, comparisonKey, isWithinRoot, PathError } from './canonical-path'

/**
 * 本文件的用例与 `docs/design/vfs-abstraction-design.md` §4.2 的规则表一一对应，
 * 并与 `backend-go/fileops/vfs_path_test.go` 保持同一份契约。
 * 规则表改了，两边必须同步改。
 */

describe('canonicalizePath', () => {
  // ---- 规则 1-3：盘符与分隔符 ----
  test.each([
    ['C:\\Users\\me\\a.txt', 'C:/Users/me/a.txt'],
    ['C:\\Users\\\\me\\a.txt', 'C:/Users/me/a.txt'],
    ['C:\\', 'C:/'],
    ['C:/', 'C:/'],
    ['C:', 'C:/'],
    ['C:/Users/', 'C:/Users'],
    ['C:\\Users/me\\a.txt', 'C:/Users/me/a.txt'],
    ['C:/Users/me/a.txt', 'C:/Users/me/a.txt'],
  ])('盘符与分隔符 %j → %j', (input: string, want: string) => {
    expect(canonicalizePath(input)).toBe(want)
  })

  // ---- 规则 4-6：UNC 与 WSL ----
  test.each([
    ['\\\\server\\share', '//server/share/'],
    ['\\\\server\\share\\', '//server/share/'],
    ['\\\\server\\share\\docs\\', '//server/share/docs'],
    ['//server/share/docs', '//server/share/docs'],
    ['///server/share/docs', '//server/share/docs'],
    ['//server//share//docs', '//server/share/docs'],
    ['\\\\wsl.localhost\\Debian\\home\\me', '//wsl.localhost/Debian/home/me'],
    ['//wsl.localhost/Debian/', '//wsl.localhost/Debian/'],
  ])('UNC 与 WSL %j → %j', (input: string, want: string) => {
    expect(canonicalizePath(input)).toBe(want)
  })

  // ---- 规则 7-10：点段折叠 ----
  test.each([
    ['/home/me/../other', '/home/other'],
    ['/home/./me', '/home/me'],
    ['//server/share/docs/../x', '//server/share/x'],
    ['C:\\Users\\me\\..\\other', 'C:/Users/other'],
  ])('根内折叠 %j → %j', (input: string, want: string) => {
    expect(canonicalizePath(input)).toBe(want)
  })

  test.each([
    '/data/../../etc',
    '//server/share/../..',
    'C:\\..\\..\\x',
    '/..',
  ])('越根必须报错 %j', (input: string) => {
    expect(() => canonicalizePath(input)).toThrow(PathError)
    expect(() => canonicalizePath(input)).toThrow('escapes its root')
  })

  // ---- 规则 11：ZIP 的将来形态（.zip 只是普通路径段）----
  test.each([
    ['D:/Downloads/temp.zip/temp/videos/', 'D:/Downloads/temp.zip/temp/videos'],
    ['D:\\Downloads\\temp.zip', 'D:/Downloads/temp.zip'],
  ])('ZIP 挂载形态 %j → %j', (input: string, want: string) => {
    expect(canonicalizePath(input)).toBe(want)
  })

  // ---- 规则 12：大小写原样保留 ----
  test('盘符与 UNC 大小写原样保留', () => {
    expect(canonicalizePath('c:/Users')).toBe('c:/Users')
    expect(canonicalizePath('\\\\SERVER\\Share\\Docs')).toBe('//SERVER/Share/Docs')
  })

  // ---- 规则 13：非绝对路径 ----
  test.each(['foo', './foo', '', 'C:Users'])('非绝对路径必须报错 %j', (input: string) => {
    expect(() => canonicalizePath(input)).toThrow(PathError)
    expect(() => canonicalizePath(input)).toThrow('not absolute')
  })

  // ---- 规则 14-16 ----
  test('特殊字符原样保留', () => {
    expect(canonicalizePath('/data/a b#c?d%e+f.txt')).toBe('/data/a b#c?d%e+f.txt')
  })

  test('反斜杠按分隔符折叠（项目约定：地址栏恒用正斜杠）', () => {
    // 见设计文档 §8.2：含反斜杠的 Unix 文件名因此在 Web UI 中不可达，这是接受的取舍。
    expect(canonicalizePath('/data/a\\b.txt')).toBe('/data/a/b.txt')
  })

  test('不做 Unicode 归一化（NFC 与 NFD 是不同字符串）', () => {
    const nfc = '/data/é.txt'
    const nfd = '/data/e\u0301.txt'
    expect(canonicalizePath(nfc)).toBe(nfc)
    expect(canonicalizePath(nfd)).toBe(nfd)
    expect(canonicalizePath(nfc)).not.toBe(canonicalizePath(nfd))
  })

  test.each([
    ['/', '/'],
    ['/home/me/a.txt', '/home/me/a.txt'],
    ['/home/me/', '/home/me'],
  ])('Unix 恒等 %j → %j', (input: string, want: string) => {
    expect(canonicalizePath(input)).toBe(want)
  })

  // ---- 畸形 UNC ----
  // 只给到主机名是最常见的误用（照着资源管理器输 `\\wsl.localhost`），
  // 给它专门的错误码，文案要能直接告诉用户该补共享名。
  test.each(['\\\\server', '//server', '//wsl.localhost/'])('UNC 缺共享名 %j', (input: string) => {
    expect(() => canonicalizePath(input)).toThrow(PathError)
    expect(() => canonicalizePath(input)).toThrow('must name a share')
    try {
      canonicalizePath(input)
    }
    catch (error) {
      expect((error as PathError).code).toBe('needs-share')
    }
  })

  test.each(['\\\\\\share', '\\\\.\\share', '\\\\server\\..'])('畸形 UNC %j', (input: string) => {
    expect(() => canonicalizePath(input)).toThrow(PathError)
    expect(() => canonicalizePath(input)).toThrow('malformed')
  })

  test('canonical 形式是不动点', () => {
    const inputs = [
      'C:\\Users\\me\\a.txt',
      '\\\\server\\share\\docs',
      '//wsl.localhost/Debian/home/me',
      '/data/../data/x',
      'D:/Downloads/temp.zip/temp/videos',
      'c:/Users',
      '/',
      'C:\\',
    ]
    for (const input of inputs) {
      const once = canonicalizePath(input)
      expect(canonicalizePath(once)).toBe(once)
    }
  })
})

describe('comparisonKey', () => {
  test.each([
    ['c:/Users/me', 'C:/Users/me'],
    ['C:', 'C:/'],
    ['C:/Users', 'C:/Users/'],
    ['//SERVER/share/docs', '//server/share/docs'],
    ['//SERVER/share', '//server/share/'],
    ['\\\\SERVER\\share\\docs', '//server/share/docs'],
  ])('同键 %j 与 %j', (a: string, b: string) => {
    expect(comparisonKey(a)).toBe(comparisonKey(b))
  })

  test.each([
    // UNC 共享名区分大小写：按敏感处理更安全
    ['//server/SHARE/x', '//server/share/x'],
    // 路径段大小写由后端 Caps.CaseSensitive 决定，键保留原样
    ['/data/Users', '/data/users'],
    ['//a/share', '//b/share'],
    ['C:/x', 'D:/x'],
  ])('不同键 %j 与 %j', (a: string, b: string) => {
    expect(comparisonKey(a)).not.toBe(comparisonKey(b))
  })
})

describe('isWithinRoot', () => {
  test.each([
    ['/data', '/data'],
    ['/data/x', '/data'],
    ['/data/x', '/data/'],
    ['/home/me', '/'],
    ['/', '/'],
    ['C:', 'C:'],
    ['C:/', 'C:'],
    ['C:/Users/me', 'C:'],
    ['//server/share/', '//server/share/'],
    ['//server/share/docs', '//server/share/'],
  ])('%j 在 %j 之内', (p: string, root: string) => {
    expect(isWithinRoot(p, root)).toBe(true)
  })

  test.each([
    // 段边界：裸 startsWith 会把 /data2 判成在 /data 之内
    ['/data2', '/data'],
    ['/data2/x', '/data'],
    ['C:/Users2', 'C:/Users'],
    ['D:/x', 'C:'],
    ['//server/share2', '//server/share'],
    ['//server/other/x', '//server/share'],
    ['', '/data'],
    ['/data', ''],
  ])('%j 不在 %j 之内', (p: string, root: string) => {
    expect(isWithinRoot(p, root)).toBe(false)
  })
})
