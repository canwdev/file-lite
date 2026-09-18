import { describe, expect, mock, test } from 'bun:test'

/**
 * `utils/index.ts` 会读 `drives.ts` 的挂载点列表，而后者依赖 `@/api/filesystem`
 * 与 vue 的响应式。这里把那个模块整体替换掉，就能在没有网络 / 没有 Vue 的情况下
 * 直接测挂载感知的导航函数。
 *
 * 模块级函数测的是「挂载表为空」的兜底行为（见下面 describe 的注释）。
 */
mock.module('../ExplorerUI/drives', () => ({
  mountPaths: () => [] as readonly string[],
}))

const { canGoUp, getBreadcrumbSegments, getParentPath, getVolumeBoundary, normalizeListingPath, normalizePath } = await import('./index')
const { currentChildNameFor, findMountRoot, syntacticRoot } = await import('./volume-mounts')

/**
 * 路径契约。设计依据见 docs/design/vfs-abstraction-design.md §4、§5.2。
 *
 * 注意：这些函数会去读 `drives.ts` 的挂载点列表，而测试里没有后端，
 * 列表是空的——所以这里同时覆盖「挂载表已加载」的纯函数（mounts 参数）与
 * 「挂载表为空」时的兜底（模块级函数）。
 */

describe('normalizePath', () => {
  // 最重要的一条回归：前导 `//` 必须活着。
  // 旧实现里的 replace(/\/+/g, '/') 会把它折叠成 `/server/share/docs`——
  // 共享的根身份没了，后面所有按路径匹配的逻辑都会认错。
  test.each([
    ['\\\\server\\share\\docs', '//server/share/docs'],
    ['//server/share/docs', '//server/share/docs'],
    ['///server/share/docs', '//server/share/docs'],
    ['//server//share//docs', '//server/share/docs'],
    ['\\\\wsl.localhost\\Debian\\home\\me', '//wsl.localhost/Debian/home/me'],
    ['\\\\server\\share', '//server/share/'],
  ])('UNC 前导双斜杠 %j → %j', (input: string, want: string) => {
    expect(normalizePath(input)).toBe(want)
  })

  test.each([
    ['/data//x/', '/data/x'],
    ['/data/./x', '/data/x'],
    ['/data/a/../b', '/data/b'],
    ['C:\\Users\\me', 'C:/Users/me'],
  ])('其余路径仍然折叠 %j → %j', (input: string, want: string) => {
    expect(normalizePath(input)).toBe(want)
  })

  // 非法路径不抛：调用方可能正在处理用户没提交的输入
  test('非法路径回落到只统一分隔符', () => {
    expect(normalizePath('relative\\dir')).toBe('relative/dir')
  })
})

describe('findMountRoot 的段边界', () => {
  const mounts = ['/', '/data', '//server/share']

  test('最长前缀优先', () => {
    expect(findMountRoot('/data/x', mounts)).toBe('/data/')
    expect(findMountRoot('/other', mounts)).toBe('/')
  })

  // 裸 startsWith 会把 /data2 判成在 /data 之内，于是跨卷判断错了，
  // 拖拽会把跨卷复制做成同卷移动。
  test('/data2 不得匹配挂载点 /data', () => {
    expect(findMountRoot('/data2/x', mounts)).toBe('/')
    expect(findMountRoot('/data2', mounts)).toBe('/')
  })

  test('//server/share2 不得匹配 //server/share', () => {
    expect(findMountRoot('//server/share2', mounts)).toBe(null)
    expect(findMountRoot('//server/share2/doc', mounts)).toBe(null)
    expect(findMountRoot('//server/share/doc', mounts)).toBe('//server/share/')
  })

  test('盘符挂载点按段边界匹配', () => {
    expect(findMountRoot('C:/Users', ['C:', 'C:/Users'])).toBe('C:/Users/')
    expect(findMountRoot('C:/Users2', ['C:', 'C:/Users'])).toBe('C:/')
  })

  test('未命中任何挂载点时返回 null', () => {
    expect(findMountRoot('/srv/data', ['/data'])).toBe(null)
  })
})

describe('canGoUp / getParentPath（挂载表由 drives 提供，测试里为空）', () => {
  test('Unix 根不能再往上', () => {
    expect(canGoUp('/')).toBe(false)
    expect(getParentPath('/')).toBe('/')
  })

  test('盘符根不能再往上', () => {
    expect(canGoUp('C:/')).toBe(false)
    expect(getParentPath('C:/')).toBe('C:/')
  })

  test('UNC 共享根不能再往上（不能退到 //server）', () => {
    expect(canGoUp('//server/share/')).toBe(false)
    expect(getParentPath('//server/share/')).toBe('//server/share/')
  })

  test.each([
    ['/data/x', '/data/'],
    ['/data/x/y', '/data/x/'],
    ['C:/Users/me', 'C:/Users/'],
    ['C:/Users', 'C:/'],
    ['//server/share/docs', '//server/share/'],
  ])('上一级 %j → %j', (path: string, want: string) => {
    expect(getParentPath(path)).toBe(want)
  })

  test('普通目录可以往上', () => {
    expect(canGoUp('/data/x')).toBe(true)
    expect(canGoUp('C:/Users')).toBe(true)
    expect(canGoUp('//server/share/docs')).toBe(true)
  })

  // 挂载表为空时必须退回语法根，否则「上一级」会在任意目录下凭空消失
  test('挂载表为空时边界是语法根', () => {
    expect(getVolumeBoundary('/data/x')).toBe('/')
    expect(getVolumeBoundary('C:/Users/me')).toBe('C:/')
    expect(getVolumeBoundary('//server/share/docs')).toBe('//server/share/')
  })
})

describe('边界由挂载表决定', () => {
  test('Linux 上 /mnt/dev-drive 是一个挂载点，在那里就不能再往上', () => {
    const mounts = ['/mnt/dev-drive']
    expect(findMountRoot('/mnt/dev-drive/x', mounts)).toBe('/mnt/dev-drive/')
    // 语法上 /mnt/dev-drive 还能往上，但挂载边界说不能
    expect(syntacticRoot('/mnt/dev-drive/x')).toBe('/')
  })
})

describe('面包屑', () => {
  test('Unix：第一段是挂载点根', () => {
    expect(getBreadcrumbSegments('/data/x/y')).toEqual([
      { name: '/', path: '/' },
      { name: 'data', path: '/data/' },
      { name: 'x', path: '/data/x/' },
      { name: 'y', path: '/data/x/y/' },
    ])
  })

  test('盘符：第一段是 D:/', () => {
    const segments = getBreadcrumbSegments('D:/Downloads/x')
    expect(segments[0]).toEqual({ name: 'D:', path: 'D:/' })
    expect(segments.map(s => s.path)).toEqual(['D:/', 'D:/Downloads/', 'D:/Downloads/x/'])
  })

  test('UNC：第一段是共享根，且前导 // 不被折叠', () => {
    const segments = getBreadcrumbSegments('//server/share/docs')
    expect(segments[0].path).toBe('//server/share/')
    expect(segments.map(s => s.path)).toEqual(['//server/share/', '//server/share/docs/'])
  })

  test('空路径没有面包屑（未选中位置）', () => {
    expect(getBreadcrumbSegments('')).toEqual([])
  })

  test('每段的 path 都是 listing 形态，可直接导航', () => {
    for (const seg of getBreadcrumbSegments('/a/b/c')) {
      expect(seg.path.endsWith('/')).toBe(true)
      expect(normalizeListingPath(seg.path)).toBe(seg.path)
    }
  })
})

/**
 * 面包屑下拉里「当前目录」的定位。
 *
 * 返回的是**名字**而不是下标：子目录列表按目录自身的排序规则产出，
 * 用名字去 findIndex 才不会因为排序规则不同而错位。
 */
describe('currentChildNameFor', () => {
  test('当前目录是下一级', () => {
    expect(currentChildNameFor('/a/b/', '/a/b/c/')).toBe('c')
  })

  test('当前目录在更深处时取沿途第一段', () => {
    // 从 /a/b 的下拉里看：当前在 /a/b/c/d，要标出来的是 c
    expect(currentChildNameFor('/a/b/', '/a/b/c/d/')).toBe('c')
  })

  test('当前目录就是该段自身：没有可高亮的项', () => {
    expect(currentChildNameFor('/a/b/', '/a/b/')).toBe(null)
    expect(currentChildNameFor('/', '/')).toBe(null)
  })

  test('当前目录不在该段之下：没有可高亮的项（前缀相同但不同目录）', () => {
    // /a/b2 不是 /a/b 的子目录
    expect(currentChildNameFor('/a/b/', '/a/b2/')).toBe(null)
    // 兄弟分支
    expect(currentChildNameFor('/a/b/', '/a/x/')).toBe(null)
  })

  test('盘符与 UNC 形态同样适用', () => {
    expect(currentChildNameFor('D:/', 'D:/Users/')).toBe('Users')
    expect(currentChildNameFor('//server/share/', '//server/share/docs/')).toBe('docs')
  })

  test('段名与尾斜杠写法无关', () => {
    expect(currentChildNameFor('/a/b', '/a/b/c')).toBe('c')
    expect(currentChildNameFor('/a/b/', '/a/b/c')).toBe('c')
  })
})
