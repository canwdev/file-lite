import antfu from '@antfu/eslint-config'

/**
 * 分层约束：app 层不得依赖文件管理器的内部实现。
 *
 * 背景：挂载卷的读写原语原先住在 `views/FileManager/ExplorerUI/`，而 `views/Apps/`
 * 要用它，于是 app 反向 import 了文件管理器的内部模块，并且每个 app 都自己判断
 * 「这条路径属于哪一侧」——那正是「写挂载卷时漏掉只读守卫」的来源。
 *
 * 现在读写统一走门面 `@/utils/fs`，app 层不再需要这些内部模块。用 lint 守住，
 * 否则几周后同样的分散会重新长出来。
 */
const fsBoundary = {
  files: ['src/views/Apps/**', 'src/hooks/**'],
  rules: {
    'no-restricted-imports': ['error', {
      patterns: [
        {
          group: [
            '**/FileManager/ExplorerUI/browser-fs',
            '**/FileManager/ExplorerUI/client-tasks',
            '**/FileManager/ExplorerUI/mount-write',
            '**/FileManager/ExplorerUI/mounted-volumes',
            '@/views/FileManager/ExplorerUI/browser-fs',
            '@/views/FileManager/ExplorerUI/client-tasks',
            '@/views/FileManager/ExplorerUI/mount-write',
            '@/views/FileManager/ExplorerUI/mounted-volumes',
          ],
          message: '请用共享门面 `@/utils/fs`（路径判断用 `@/utils/fs/paths`），不要依赖文件管理器的内部模块。',
        },
      ],
    }],
  },
}

/**
 * 存储契约：**只有 `@/utils/fs` 可以直连后端文件 API。**
 *
 * 其余调用点一律走门面。直连后端是这个功能里最容易漏、也最难发现的错法：路径属于
 * 浏览器挂载卷时，请求会带着 `/@mounted/...` 打到服务端，只得到一个 404，界面上
 * 表现为「预览没了 / 面包屑打不开」，既没有 toast 也没有堆栈。
 *
 * 白名单只有登录相关的三个方法（`auth` / `login` / `consumeTicket`）——它们不是
 * 文件操作，不该被塞进存储门面。
 */
const storageContract = {
  files: ['src/**/*.{ts,vue}'],
  // `utils/fs` 是门面本身，`api/` 是定义处；登录相关的两个入口用的是
  // `fsWebApi.auth` / `login` / `consumeTicket`——那是平台调用，不是文件操作，
  // 不该被塞进存储门面，所以在契约里显式豁免。
  ignores: ['src/utils/fs/**', 'src/api/**', 'src/router/index.ts', 'src/views/Login.vue'],
  rules: {
    'no-restricted-imports': ['error', {
      paths: [{
        name: '@/api/filesystem',
        importNames: ['fsWebApi'],
        message: '只有 @/utils/fs 可以直接用 fsWebApi。请改走门面（fs.list / fs.writeText / fs.url / fs.existingPaths …）；登录相关的 fsWebApi.auth / login / consumeTicket 请从 @/api/filesystem 具名导入。',
      }],
    }],
  },
}

export default antfu({
  // Enable stylistic rules
  stylistic: true,

  // TypeScript and Vue are auto-detected, but we can be explicit if needed
  typescript: true,
  vue: true,

  // Ignore files
  ignores: [
    'dist',
    'node_modules',
    'public',
    '*.d.ts',
  ],

  // Custom rules
  rules: {
    'no-console': 'off',
    'regexp/no-unused-capturing-group': 'off',
    'ts/no-use-before-define': 'off',
    'e18e/prefer-static-regex': 'off',
    'no-alert': 'warn',
    // 'ts/no-explicit-any': 'error',
  },
}, fsBoundary, storageContract)
