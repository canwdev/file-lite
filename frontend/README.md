# frontend

Vue 3 + Vite + TypeScript frontend application.

## Development and Build

Use Bun to install dependencies and run scripts. The `vite` in the build script is executed by Node, so Node `^20.19.0 || >=22.12.0` is also required.

```sh
bun i

# development
bun run dev

# build: outputs to backend-go/frontend/, and packages as backend-go/frontend-assets.tar.gz (gzip-compressed assets embedded in the Go binary)
bun run build
```

## Internationalization

- Locale files are at `src/i18n/locales/<locale>/index.json`; all copy is under a single-level namespace `file_lite_i18n`.
- `en-US` is the base language; entries not translated in other languages fall back to `en-US` at runtime.
- Locale files are imported asynchronously on demand (`loadLocaleMessages`): only the currently used language is downloaded, not included in the main bundle.
- In templates use `$t` (injected by vue-i18n); `$t` in `<script setup>` and `.ts` is auto-imported from `@/i18n` by unplugin-auto-import.
- The UI language is stored in the `language` field of the server-side `file_lite_settings_store`; on first visit it is detected from the browser language and written back.
- To add non-technical copy, edit the locale files directly; **prefer reusing existing entries for the same meaning**, do not create a separate entry; do not auto-translate unless the user asks for translation.
- Keep technical content literal and out of locale files: thrown exceptions, error messages in `hooks/` and `api/`, `description` of `useShortcut`, key names, comparison values, and pure format strings (URL, CSS, HTML).
- Ellipses also do not go into locale files: store copy without ellipsis in locale files, and append it at the call site using `ELLIPSIS` (see `src/i18n/index.ts`) or by writing `…` directly in the template.