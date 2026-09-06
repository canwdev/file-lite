import type { ESBuildOptions } from 'vite'
import { fileURLToPath, URL } from 'node:url'
import vue from '@vitejs/plugin-vue'
import vueJsx from '@vitejs/plugin-vue-jsx'
import AutoImport from 'unplugin-auto-import/vite'
import IconsResolver from 'unplugin-icons/resolver'
import Icons from 'unplugin-icons/vite'
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
      vue({
        template: {
          compilerOptions: {
            isCustomElement: tag => tag.startsWith('flyfish-'),
          },
        },
      }),
      vueJsx(),
      Icons({
        compiler: 'vue3',
        // scale 1: svg 尺寸 = 1em = 继承的 font-size，与 @mdi/font 字形框一致，避免布局/视觉尺寸漂移
        scale: 1,
      }),
      AutoImport({
        dts: './src/auto-import.d.ts',
        imports: ['vue', 'vue-router', 'pinia'],
        resolvers: [ElementPlusResolver()],
      }),
      Components({
        dirs: [],
        resolvers: [
          ElementPlusResolver(),
          IconsResolver({
            enabledCollections: ['mdi'],
          }),
        ],
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
        '/api': {
          target: 'http://localhost:3111',
          changeOrigin: true,
          ws: true,
          rewriteWsOrigin: true,
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
    // 生产移除 console.log；保留原 esbuild pure 配置
    esbuild: {
      pure: ['console.log'],
    } as ESBuildOptions,
  }
})
