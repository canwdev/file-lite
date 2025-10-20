// 定义历史记录项的接口，支持存储路径 path 和任意自定义数据 T
export interface HistoryItem<T = any> {
  path: string
  data?: T // 存储任意自定义数据，如滚动位置
}

/**
 * 导航历史记录管理类
 * 支持路径导航、前进、后退，并可在历史记录中存储自定义数据
 */
export class NavigationHistory<T = any> {
  // 存储访问过的历史记录，每个元素是 HistoryItem 类型
  history: HistoryItem<T>[]
  // 当前路径在 history 数组中的索引
  currentIndex: number
  // 日志配置：是否启用日志打印
  enableLogging: boolean = true

  /**
   * 构造函数
   * @param initialPath 初始路径，默认为 '/'
   * @param data
   * @param enableLogging 是否启用日志打印，默认为 true
   */
  constructor(initialPath = '/', data?: T, enableLogging: boolean = false) {
    // 初始化历史记录，存储 HistoryItem 对象
    this.history = [{ path: initialPath, data }]
    // 初始化当前索引
    this.currentIndex = 0
    // 配置日志打印
    this.enableLogging = enableLogging

    this._log(`初始化：当前路径 -> ${this.getCurrentPath()}`)
  }

  /**
   * 内部日志方法
   * @param message 要打印的消息
   */
  private _log(...message: any[]) {
    if (this.enableLogging) {
      console.log(...message)
    }
  }

  /**
   * 获取当前路径
   */
  getCurrentPath(): string {
    return this.history[this.currentIndex].path
  }

  /**
   * 获取当前历史记录项的自定义数据
   */
  getCurrent(): HistoryItem<T> | undefined {
    return this.history[this.currentIndex]
  }

  /**
   * 导航到新路径
   * @param newPath 新路径
   * @param data 随新路径存储的自定义数据
   */
  go(newPath: string, data?: T) {
    if (newPath === this.getCurrentPath()) {
      this._log(`'${newPath}' 是当前路径，不进行跳转。`)
      return
    }

    // 1. **清除“未来”历史**：
    // 如果当前不在历史记录的末尾，跳转新路径会清除从当前位置到末尾的所有记录。
    if (this.currentIndex < this.history.length - 1) {
      this.history.splice(this.currentIndex + 1)
    }

    // 2. **添加新的历史记录项**：
    const newItem: HistoryItem<T> = { path: newPath, data }
    this.history.push(newItem)

    // 3. **更新索引**：
    this.currentIndex = this.history.length - 1

    this._log(`导航到 '${newPath}'。当前路径 -> ${this.getCurrentPath()}`)
    this._logStatus()
  }

  /**
   * 后退一步
   * @returns 后退后的历史记录项 (包含 path 和 data)，如果无法后退则返回 null
   */
  back(): HistoryItem<T> | null {
    if (this.canBack) {
      this.currentIndex--
      const currentItem = this.history[this.currentIndex]
      this._log(`执行后退 (back)。当前路径 -> ${currentItem.path}`)
      this._logStatus()
      return currentItem
    }
    else {
      this._log('无法后退，已到达历史记录起点。')
      return null
    }
  }

  /**
   * 前进一步
   * @returns 前进后的历史记录项 (包含 path 和 data)，如果无法前进则返回 null
   */
  forward(): HistoryItem<T> | null {
    if (this.canForward) {
      this.currentIndex++
      const currentItem = this.history[this.currentIndex]
      this._log(`执行前进 (forward)。当前路径 -> ${currentItem.path}`)
      this._logStatus()
      return currentItem
    }
    else {
      this._log('无法前进，已到达历史记录末尾。')
      return null
    }
  }

  get canForward(): boolean {
    return this.currentIndex < this.history.length - 1
  }

  get canBack(): boolean {
    return this.currentIndex > 0
  }

  getPrevious(): HistoryItem<T> | null {
    if (this.canBack) {
      return this.history[this.currentIndex - 1]
    }
    else {
      return null
    }
  }

  getNext(): HistoryItem<T> | null {
    if (this.canForward) {
      return this.history[this.currentIndex + 1]
    }
    else {
      return null
    }
  }

  /**
   * 打印当前状态（仅在启用日志时）
   */
  private _logStatus() {
    this._log(`[状态] History:`, this.history)
    this._log(`[状态] Current Index: ${this.currentIndex}`)
    this._log(`[状态] Current Data: ${JSON.stringify(this.history[this.currentIndex].data)}`) // 打印自定义数据
    this._log('---')
  }
}
