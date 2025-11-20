import { exec } from 'node:child_process'
import os from 'node:os'

export async function getWindowsDrives(): Promise<string[]> {
  return new Promise((resolve, reject) => {
    if (os.platform() !== 'win32') {
      // reject(new Error('This function only works on Windows.'))
      return []
    }

    exec('fsutil fsinfo drives', (error, stdout, stderr) => {
      if (error) {
        console.error(`exec error: ${error}`)
        reject(error)
        return
      }
      if (stderr) {
        console.error(`stderr: ${stderr}`)
        reject(new Error(stderr))
        return
      }

      // Parse the output of fsutil
      const lines = stdout.trim().split('\n')
      if (lines.length === 0) {
        resolve([]) // No drives found
        return
      }

      // The last line contains the drives.  Example: "Drives: A:\ C:\ D:\"
      const drivesLine = lines[lines.length - 1] || ''
      const drives = drivesLine.split(' ').filter(value => /[A-Z]:\\/i.test(value)).map(value => value.trim().slice(0, -1))

      resolve(drives)
    })
  })
}
