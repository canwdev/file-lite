import mitt from 'mitt'

const explorerBus = mitt<{
  [ExplorerEvents.SELECT_COLLECTED]: { basePath: string, names: string[] }
}>()

export default explorerBus

export const ExplorerEvents = {
  REFRESH: 'REFRESH',
  SELECT_COLLECTED: 'SELECT_COLLECTED',
}

export function useExplorerBusOn(event: string, fn: any) {
  onMounted(() => {
    explorerBus.on(event, fn)
  })
  onBeforeUnmount(() => {
    explorerBus.off(event, fn)
  })
}
