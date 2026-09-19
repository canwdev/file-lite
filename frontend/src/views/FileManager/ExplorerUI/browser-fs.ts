/**
 * 浏览器挂载卷的读写原语——**已迁至** `@/utils/fs/browser-backend`。
 *
 * 这个文件保留为转发层，只是为了不让历史 import 路径一夜之间全部失效。新代码请直接
 * 用共享层：
 *
 * - 需要「按路径自动选后端」的，用门面 `@/utils/fs` 的 `writeText` / `list` /
 *   `rename` / `remove` / `url`；
 * - 只有**确实在实现挂载卷后端本身**（如 `client-tasks` 的字节搬运）才直接用
 *   `@/utils/fs/browser-backend` 的原语。
 *
 * 之所以搬走：原语原先住在 `views/FileManager/ExplorerUI/` 下，而 `views/Apps/` 要用
 * 它，于是 app 层反向依赖了文件管理器的内部模块——分层被打穿，而且每个 app 都得自己
 * 判断「这条路径属于哪一侧」，那正是「写挂载卷时漏掉只读守卫」的来源。
 */
export * from '../../../utils/fs/browser-backend'
