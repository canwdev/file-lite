import antfu from '@antfu/eslint-config'

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
    'no-alert': 'warn',
    // 'ts/no-explicit-any': 'error',
  },
})
