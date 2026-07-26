import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import Path from 'node:path'

export const TLS_KEY_FILE = 'key.pem'
export const TLS_CERT_FILE = 'cert.pem'

/** Run system openssl; no probe. Skip if both files already exist. */
export function ensureSelfSignedTls(dataDir: string): { key: string, cert: string, generated: boolean } {
  const keyPath = Path.resolve(dataDir, TLS_KEY_FILE)
  const certPath = Path.resolve(dataDir, TLS_CERT_FILE)

  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    return { key: TLS_KEY_FILE, cert: TLS_CERT_FILE, generated: false }
  }

  const result = spawnSync('openssl', [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    keyPath,
    '-out',
    certPath,
    '-days',
    '365',
    '-subj',
    '/CN=file-lite',
    '-addext',
    'subjectAltName=DNS:localhost,IP:127.0.0.1',
  ], {
    encoding: 'utf8',
  })

  if (result.error || result.status !== 0) {
    const detail = result.stderr || result.stdout || result.error?.message || ''
    throw new Error(`openssl failed (install openssl and ensure it is in PATH)\n${detail}`.trim())
  }

  return { key: TLS_KEY_FILE, cert: TLS_CERT_FILE, generated: true }
}
