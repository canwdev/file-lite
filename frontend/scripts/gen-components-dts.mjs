// unplugin-vue-components only writes components.d.ts while transforming SFCs,
// so a fresh checkout has no declaration file for the auto-registered El* and
// icon components. Run the build without emitting the bundle to generate it.
import { build } from 'vite'

await build({
  logLevel: 'warn',
  build: {
    write: false,
    emptyOutDir: false,
  },
})
