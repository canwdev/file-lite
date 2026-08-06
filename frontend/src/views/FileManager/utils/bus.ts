import mitt from 'mitt'

export const ExplorerEvents = {
  REFRESH: 'REFRESH',
  SELECT_COLLECTED: 'SELECT_COLLECTED',
  REVEAL_ITEM: 'REVEAL_ITEM',
} as const

// mitt 要求事件表满足 Record<EventType, unknown>，interface 没有隐式索引签名，只能用 type
// eslint-disable-next-line ts/consistent-type-definitions
type ExplorerBusEvents = {
  [ExplorerEvents.REFRESH]: void
  [ExplorerEvents.SELECT_COLLECTED]: { basePath: string, names: string[] }
  [ExplorerEvents.REVEAL_ITEM]: { basePath: string, name: string }
}

const explorerBus = mitt<ExplorerBusEvents>()

export default explorerBus

export function useExplorerBusOn<T extends keyof ExplorerBusEvents>(
  event: T,
  fn: (payload: ExplorerBusEvents[T]) => void,
) {
  onMounted(() => {
    explorerBus.on(event, fn)
  })
  onBeforeUnmount(() => {
    explorerBus.off(event, fn)
  })
}
