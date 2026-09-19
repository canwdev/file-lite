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
}, fsBoundary)
