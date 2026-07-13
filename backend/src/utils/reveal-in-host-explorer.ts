import { Buffer } from 'node:buffer'
import { execFile } from 'node:child_process'
import { release } from 'node:os'
import Path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { opener } from '@/utils/server-utils.ts'

const execFileAsync = promisify(execFile)

function platform(): NodeJS.Platform {
  return process.platform === 'linux' && release().includes('Microsoft') ? 'win32' : process.platform
}

function nativePath(p: string) {
  return Path.resolve(p)
}

function groupByParent(paths: string[]) {
  const groups = new Map<string, string[]>()
  for (const p of paths) {
    const resolved = nativePath(p)
    const parent = Path.dirname(resolved)
    const list = groups.get(parent) ?? []
    list.push(resolved)
    groups.set(parent, list)
  }
  return groups
}

function psQuote(value: string) {
  return `'${value.replace(/'/g, '\'\'')}'`
}

function runPs(script: string) {
  return execFileAsync('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-EncodedCommand',
    Buffer.from(script, 'utf16le').toString('base64'),
  ], { windowsHide: true }).then(() => undefined)
}

function openPath(target: string) {
  return new Promise<void>((resolve, reject) => {
    opener(target, (error: Error | null) => error ? reject(error) : resolve())
  })
}

/** Open Explorer and select files via SHOpenFolderAndSelectItems (PowerShell + C#). */
function openAndSelectViaPowerShell(parentDir: string, files: string[]) {
  return runPs(`
$code = @"
using System;
using System.Runtime.InteropServices;

public class ExplorerHelper {
  [DllImport("shell32.dll", ExactSpelling = true)]
  static extern void ILFree(IntPtr pidlList);
  [DllImport("shell32.dll", CharSet = CharSet.Unicode, ExactSpelling = true)]
  static extern IntPtr ILCreateFromPathW(string pszPath);
  [DllImport("shell32.dll", ExactSpelling = true)]
  static extern int SHOpenFolderAndSelectItems(IntPtr pidlFolder, uint cidl, IntPtr[] apidl, uint dwFlags);

  public static void OpenAndSelect(string dir, string[] files) {
    if (files.Length == 1) {
      IntPtr pidl = ILCreateFromPathW(files[0]);
      SHOpenFolderAndSelectItems(pidl, 0, null, 0);
      ILFree(pidl);
      return;
    }
    IntPtr dirPidl = ILCreateFromPathW(dir);
    IntPtr[] filePidls = new IntPtr[files.Length];
    for (int i = 0; i < files.Length; i++) filePidls[i] = ILCreateFromPathW(files[i]);
    SHOpenFolderAndSelectItems(dirPidl, (uint)files.Length, filePidls, 0);
    ILFree(dirPidl);
    for (int i = 0; i < files.Length; i++) ILFree(filePidls[i]);
  }
}
"@
Add-Type -TypeDefinition $code
[ExplorerHelper]::OpenAndSelect(${psQuote(parentDir)}, @(${files.map(psQuote).join(',')}))
`)
}

async function revealWindows(paths: string[]) {
  for (const [parentDir, files] of groupByParent(paths)) {
    try {
      await openAndSelectViaPowerShell(parentDir, files)
    }
    catch {
      await openPath(parentDir)
    }
  }
}

async function revealDarwin(paths: string[]) {
  for (const files of groupByParent(paths).values()) {
    await execFileAsync('open', ['-R', files[0] as string])
  }
}

async function revealLinux(paths: string[]) {
  const uris = [...new Set(paths.map(p => pathToFileURL(nativePath(p)).href))]
  try {
    await execFileAsync('dbus-send', [
      '--session',
      '--print-reply',
      '--dest=org.freedesktop.FileManager1',
      '/org/freedesktop/FileManager1',
      'org.freedesktop.FileManager1.ShowItems',
      `array:string:${uris.join(',')}`,
      'string:',
    ])
  }
  catch {
    for (const parent of groupByParent(paths).keys()) {
      await execFileAsync('xdg-open', [parent])
    }
  }
}

export async function revealInHostExplorer(paths: string[]) {
  if (!paths.length)
    throw new Error('paths parameter is required')

  switch (platform()) {
    case 'win32':
      return revealWindows(paths)
    case 'darwin':
      return revealDarwin(paths)
    default:
      return revealLinux(paths)
  }
}
