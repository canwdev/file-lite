import type { ESBuildOptions } from 'vite'
import { fileURLToPath, URL } from 'node:url'
import vue from '@vitejs/plugin-vue'
import AutoImport from 'unplugin-auto-import/vite'
import IconsResolver from 'unplugin-icons/resolver'
import Icons from 'unplugin-icons/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'
import Components from 'unplugin-vue-components/vite'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig(() => {
  // The project ships a single (Go) backend, so every build emits into the Go embed source.
  const outDir = '../backend-go/frontend'
  return {
    plugins: [
      {
        name: 'cross-origin-isolation',
        configureServer(server) {
          // BoxedWine's multithreaded wasm needs SharedArrayBuffer, which
          // browsers only expose to cross-origin isolated documents. Set the
          // headers on every dev response so the app shell and the proxied
          // plugin pages are isolated (production sets the same ones in Go).
          server.middlewares.use((_req, res, next) => {
            res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
            res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless')
            next()
          })
        },
      },
      vue({
        template: {
          compilerOptions: {
            isCustomElement: tag => tag.startsWith('flyfish-'),
          },
        },
      }),
      Icons({
        compiler: 'vue3',
        // scale 1: svg 尺寸 = 1em = 继承的 font-size，避免布局/视觉尺寸漂移
        scale: 1,
      }),
      AutoImport({
        dts: './src/auto-import.d.ts',
        // `$t` 在模板里由 vue-i18n 的 globalInjection 提供，在脚本里由这里自动引入，
        // 两条路径最终都是 `@/i18n` 的同一个函数。
        imports: ['vue', 'vue-router', 'pinia', { '@/i18n': ['$t', 'ELLIPSIS'] }],
        vueTemplate: true,
        // vgo-ui 是用 `bun link` 链到仓库外的，默认的 node_modules 排除覆盖不到；
        // 它的 dist 里正好有自己的 `$t` 变量，被自动引入会变成重复声明。
        exclude: [/[\\/]node_modules[\\/]/, /[\\/]\.git[\\/]/, /[\\/]vgo-ui[\\/]/],
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
        '/plugins': {
          target: 'http://localhost:3111',
          changeOrigin: true,
        },
        '/ie': {
          target: 'http://localhost:3111',
          changeOrigin: true,
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
