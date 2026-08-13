/**
 * 动态加载 script src，支持并发加载相同url不冲突，不重复加载，支持失败自动重试。
 * @param {string} src - 脚本地址
 * @param {number} maxRetries - 最大重试次数，默认为 3 次 (首次加载 + 2次重试)
 * @returns {Promise<void>}
 */
const loadingScripts: Record<string, Promise<void>> = {} // 保存正在加载的 script 的 Promise

function dynamicLoadScript(src: string, maxRetries = 2): Promise<void> {
  // 1. 检查是否已经在加载中
  if (src in loadingScripts) {
    // 直接返回正在进行的 Promise，这样所有并发调用都会等待同一个结果
    return loadingScripts[src]
  }

  // 2. 检查是否已经存在该 script (且加载成功)
  const existingScript = document.getElementById(src)
  if (existingScript) {
    return Promise.resolve() // script 已经加载，直接 resolve
  }

  // 3. 创建一个新的 Promise 来处理加载过程（包含重试逻辑）
  const loadPromise = new Promise<void>((resolve, reject) => {
    // 内部函数：执行单次加载尝试
    const attemptLoad = (retriesLeft: number) => {
      // console.log(`[dynamicLoadScript] loading: ${src}, retries left: ${retriesLeft}`)

      const script = document.createElement('script')
      script.src = src
      script.id = src // 以此作为判断是否存在的依据
      script.async = true

      // 加载成功处理
      script.onload = function () {
        this.onerror = this.onload = null
        delete loadingScripts[src] // 加载完成后从缓存中移除 Promise
        resolve()
      }

      // 加载失败处理
      script.onerror = function (e) {
        this.onerror = this.onload = null
        // 关键：加载失败必须移除当前标签，否则重试时会产生重复 ID 或污染 DOM
        document.body.removeChild(script)

        if (retriesLeft > 0) {
          console.warn(`[dynamicLoadScript] load failed, retrying... (${retriesLeft} left): ${src}`)
          // 可以在这里加一个 setTimeout 来延迟重试，例如 100ms
          setTimeout(() => {
            attemptLoad(retriesLeft - 1)
          }, 100)
        }
        else {
          // 重试次数用尽，彻底失败
          delete loadingScripts[src] // 移除缓存，允许下次重新调用触发新的加载
          const error = new Error(`[dynamicLoadScript] load script error after retries: ${src}`)
          console.error('[dynamicLoadScript] final error:', e)
          reject(error)
        }
      }

      document.body.appendChild(script)
    }

    // 启动首次加载
    attemptLoad(maxRetries)
  })

  // 将 Promise 存入缓存
  loadingScripts[src] = loadPromise

  return loadPromise
}

// 并发加载 script src
export function batchDynamicLoadScript(srcs: string[], maxRetries?: number) {
  return Promise.all(srcs.map(src => dynamicLoadScript(src, maxRetries)))
}

// 顺序加载 script src
export function batchDynamicLoadScriptSeq(srcs: string[], maxRetries?: number) {
  return srcs.reduce((prevPromise: Promise<void>, currentSrc: string) => {
    return prevPromise.then(() => dynamicLoadScript(currentSrc, maxRetries))
  }, Promise.resolve())
}

export default dynamicLoadScript
