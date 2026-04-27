import * as fs from 'node:fs'
import * as nodePath from 'node:path'

const CREATE_CONCURRENCY = 256

export async function createFiles(path: string, count: number): Promise<string[]> {
  if (!Number.isInteger(count) || count < 0) {
    throw new RangeError('count must be a non-negative integer')
  }

  if (fs.existsSync(path)) {
    await fs.promises.rm(path, { recursive: true })
  }
  await fs.promises.mkdir(path, { recursive: true })

  const filePaths = new Array<string>(count)
  let nextIndex = 0

  async function worker(): Promise<void> {
    while (nextIndex < count) {
      const index = nextIndex++
      const filePath = nodePath.join(path, `test-1-${index + 1}.txt`)
      filePaths[index] = filePath

      try {
        await fs.promises.writeFile(filePath, '', { flag: 'wx' })
      } catch (error) {
        if (!isFileExistsError(error)) {
          throw error
        }
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(count, CREATE_CONCURRENCY) },
    () => worker(),
  )

  await Promise.all(workers)

  return filePaths
}

function isFileExistsError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'EEXIST'
  )
}

createFiles('../demo', 1)