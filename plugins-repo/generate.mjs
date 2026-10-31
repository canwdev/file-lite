#!/usr/bin/env node
/**
 * generate.mjs -- Build the plugin catalog from the plugins directory.
 *
 * Sources:
 *   - <plugins>/<id>/file-lite-plugin.json   plugin metadata
 *   - download.json                          manual id -> release asset URL
 *
 * By default only index.json is written, from the plugins directory. Pass
 * --readme to refresh the "Currently Available Plugins" section of README.md
 * from the existing index.json and download.json. A plugin without an entry in
 * download.json is still listed, just not as a link.
 *
 * Usage:
 *   node generate.mjs [--plugins <dir>] [--readme] [--check]
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_DIR = path.resolve(HERE, '..')
const DEFAULT_PLUGINS_DIR = path.join(REPO_DIR, 'backend-go', 'file-lite', 'plugins')
const INDEX_PATH = path.join(HERE, 'index.json')
const DOWNLOADS_PATH = path.join(HERE, 'download.json')
const README_PATH = path.join(HERE, 'README.md')
const MANIFEST_FILE = 'file-lite-plugin.json'
const HEADING = '## Currently Available Plugins'

function parseArgs(argv) {
  const options = { pluginsDir: DEFAULT_PLUGINS_DIR, readme: false, check: false }
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--plugins':
        options.pluginsDir = path.resolve(argv[++i] ?? '')
        break
      case '--readme':
        options.readme = true
        break
      case '--check':
        options.check = true
        break
      case '--help':
      case '-h':
        console.log('Usage: node generate.mjs [--plugins <dir>] [--readme] [--check]')
        process.exit(0)
      default:
        console.error(`Unknown option: ${argv[i]}`)
        process.exit(1)
    }
  }
  return options
}

const trim = (value) => (typeof value === 'string' ? value.trim() : '')

async function readJSON(file, what, optional = false) {
  let body
  try {
    body = await fs.readFile(file, 'utf8')
  } catch (err) {
    if (optional && err.code === 'ENOENT') return undefined
    throw new Error(`Cannot read ${what} ${file}: ${err.message}`)
  }
  try {
    return JSON.parse(body)
  } catch (err) {
    throw new Error(`${file}: ${err.message}`)
  }
}

async function scanPlugins(pluginsDir) {
  let entries
  try {
    entries = await fs.readdir(pluginsDir, { withFileTypes: true })
  } catch (err) {
    throw new Error(`Cannot read plugins directory ${pluginsDir}: ${err.message}`)
  }

  const plugins = []
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const pluginDir = path.join(pluginsDir, entry.name)
    let info
    try {
      // Follow links: a plugin folder may be linked from a build output elsewhere.
      info = await fs.stat(pluginDir)
    } catch {
      continue
    }
    if (!info.isDirectory()) continue

    const manifestPath = path.join(pluginDir, MANIFEST_FILE)
    const manifest = await readJSON(manifestPath, 'manifest', true)
    if (manifest === undefined) continue
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
      throw new Error(`${manifestPath}: expected a JSON object`)
    }

    const id = entry.name
    plugins.push({
      id,
      name: trim(manifest.name) || id,
      description: trim(manifest.description),
      version: trim(manifest.version),
      repo: trim(manifest.repo),
    })
  }

  plugins.sort((a, b) => a.id.toLowerCase().localeCompare(b.id.toLowerCase()))
  return plugins
}

async function readDownloads() {
  const parsed = await readJSON(DOWNLOADS_PATH, 'download map', true)
  if (parsed === undefined) return {}
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${DOWNLOADS_PATH}: expected an object mapping plugin ids to URLs`)
  }
  const downloads = {}
  for (const [id, url] of Object.entries(parsed)) {
    if (typeof url !== 'string' || url.trim() === '') {
      throw new Error(`${DOWNLOADS_PATH}: "${id}" must map to a URL`)
    }
    downloads[id] = url.trim()
  }
  return downloads
}

function renderIndex(plugins) {
  return JSON.stringify({ plugins }, null, 2) + '\n'
}

function repoLabel(url) {
  try {
    const parsed = new URL(url)
    const parts = parsed.pathname.replace(/^\/+|\/+$/g, '').split('/')
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : parsed.hostname
  } catch {
    return url
  }
}

function archiveLabel(url) {
  try {
    return decodeURIComponent(new URL(url).pathname.split('/').pop() || '') || url
  } catch {
    return url
  }
}

function renderSection(plugins, downloads) {
  const lines = [
    HEADING,
    '',
    'Source repositories and plugin archives are linked in the table.',
    '',
    '| Plugin | Version | Repo | Download | Description |',
    '| --- | --- | --- | --- | --- |',
  ]
  const escapeLabel = (value) => String(value).replace(/([\\[\]])/g, '\\$1')
  const cell = (value) => String(value ?? '').replace(/\r?\n/g, ' ').replace(/\|/g, '\\|')
  const link = (label, url) => url ? `[${escapeLabel(label)}](${url})` : ''

  if (plugins.length === 0) {
    lines.push('| - | - | - | - | No plugins are available yet. |')
  } else {
    for (const plugin of plugins) {
      const download = downloads[plugin.id]
      const repo = plugin.repo ? link(repoLabel(plugin.repo), plugin.repo) : ''
      const archive = download ? link(archiveLabel(download), download) : ''
      lines.push(`| ${cell(plugin.name || plugin.id)} | ${cell(plugin.version)} | ${cell(repo)} | ${cell(archive)} | ${cell(plugin.description)} |`)
    }
  }
  return lines.join('\n') + '\n'
}

function replaceSection(readme, section) {
  const start = readme.indexOf(HEADING)
  if (start === -1) {
    return readme.replace(/\n*$/, '\n\n') + section
  }
  const afterHeading = start + HEADING.length
  const nextHeadingOffset = readme.slice(afterHeading).search(/\n#{1,2} /)
  if (nextHeadingOffset === -1) {
    return readme.slice(0, start) + section
  }
  const end = afterHeading + nextHeadingOffset + 1
  return readme.slice(0, start) + section + '\n' + readme.slice(end)
}

async function main() {
  const options = parseArgs(process.argv.slice(2))

  if (options.readme) {
    const index = await readJSON(INDEX_PATH, 'index')
    if (!index || !Array.isArray(index.plugins)) {
      throw new Error(`${INDEX_PATH}: expected a "plugins" array`)
    }
    const readme = await fs.readFile(README_PATH, 'utf8')
    const readmeBody = replaceSection(readme, renderSection(index.plugins, await readDownloads()))

    if (options.check) {
      if (readme !== readmeBody) {
        console.error(`Out of date: ${path.basename(README_PATH)}. Run node generate.mjs --readme.`)
        process.exit(1)
      }
      console.log(`Up to date: ${index.plugins.length} plugin(s).`)
      return
    }

    await fs.writeFile(README_PATH, readmeBody)
    console.log(`Updated ${path.relative(REPO_DIR, README_PATH)} (${index.plugins.length} plugin(s))`)
    return
  }

  const plugins = await scanPlugins(options.pluginsDir)
  const indexBody = renderIndex(plugins)

  if (options.check) {
    const currentIndex = await fs.readFile(INDEX_PATH, 'utf8').catch(() => '')
    if (currentIndex !== indexBody) {
      console.error(`Out of date: ${path.basename(INDEX_PATH)}. Run node generate.mjs.`)
      process.exit(1)
    }
    console.log(`Up to date: ${plugins.length} plugin(s).`)
    return
  }

  await fs.writeFile(INDEX_PATH, indexBody)
  console.log(`Wrote ${path.relative(REPO_DIR, INDEX_PATH)} (${plugins.length} plugin(s))`)
}

main().catch((err) => {
  console.error(`Error: ${err.message}`)
  process.exit(1)
})
