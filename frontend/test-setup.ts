/**
 * Test bootstrap for the globally auto-imported `$t`.
 *
 * unplugin-auto-import injects `$t` into `<script setup>` and plain `.ts` when
 * Vite compiles them (see vite.config.ts), but `bun test` runs the sources
 * directly, so a unit test that touches a module calling `$t` fails with
 * "ReferenceError: $t is not defined". This preload installs it globally,
 * resolved against the real en-US catalog, so tests assert the same labels the
 * UI shows and any newly added key is covered without touching the test.
 *
 * It mirrors vue-i18n's `t` for the flat `file_lite_i18n` catalog: the entry is
 * returned as-is, and a missing key falls back to the key itself.
 */
import enUS from './src/i18n/locales/en-US/index.json'

const NAMESPACE = 'file_lite_i18n.'
const messages = (enUS as unknown as { file_lite_i18n: Record<string, string> }).file_lite_i18n

function translate(key: string): string {
  const bare = key.startsWith(NAMESPACE) ? key.slice(NAMESPACE.length) : key
  return messages[bare] ?? key
}

;(globalThis as unknown as { $t: (key: string) => string }).$t = translate
