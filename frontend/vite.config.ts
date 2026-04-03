import { fileURLToPath, URL } from 'node:url'

import vue from '@vitejs/plugin-vue'
import vueJsx from '@vitejs/plugin-vue-jsx'
import AutoImport from 'unplugin-auto-import/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'
import Components from 'unplugin-vue-components/vite'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  let outDir = '../backend/dist/frontend'
  if (mode === 'go') {
    outDir = '../backend-go/frontend'
  }
  return {
    plugins: [
      vue(),
      vueJsx(),
      AutoImport({
        dts: './src/auto-import.d.ts',
        imports: ['vue', 'vue-router', 'pinia'],
        resolvers: [ElementPlusResolver()],
      }),
      Components({
        dirs: [],
        resolvers: [ElementPlusResolver()],
      }),
    ],
    base: './',
    build: {
      outDir,
      emptyOutDir: true,
      rollupOptions: {
        output: {

          sanitizeFileName: (name) => {
          // Sanitizes file names generated during the build process:
          // - Replaces spaces with dashes ('-').
          // - Removes invalid characters that are not alphanumeric, underscores (_), periods (.), or dashes (-).
            return name
              .replace(/\s+/g, '-') // Replaces spaces with dashes.
              .replace(/[^\w.-]/g, '') // Removes all invalid characters.
          },
        },
      },
    },
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      // host: '0.0.0.0',
      port: 3110,
      proxy: {
        '/dev_proxy': {
          target: 'http://localhost:3111',
          changeOrigin: true,
          rewrite: path => path.replace(/^\/dev_proxy/, ''),
          ws: true,
        },
      },
    },
    css: {
      preprocessorOptions: {
        scss: {
          additionalData: `@use "@/styles/_variables.scss" as *;`,
          silenceDeprecations: ['import', 'legacy-js-api'], // Specifically silences @import deprecation warnings
        },
      },
    },
  }
})
