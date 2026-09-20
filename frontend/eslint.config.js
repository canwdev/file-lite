import antfu from '@antfu/eslint-config'

/**
 * 存储契约：**只有 `@/utils/fs` 可以直连后端文件 API。**
 *
 * 其余调用点一律走门面，否则同一个文件操作会有两条实现路径；漏掉收尾逻辑时往往
 * 只在运行时才暴露（预览空白、列表不刷新），既没有 toast 也没有堆栈。
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
}, storageContract)
