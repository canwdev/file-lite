export default class EventEmitter {
  private events: { [key: string]: Array<(data: any) => void> }
  constructor() {
    this.events = {}
  }

  on(name: string, fn: (data: any) => void) {
    if (this.events[name]) {
      this.events[name].push(fn)
    }
    else {
      this.events[name] = [fn]
    }
    return this
  }

  once(name: string, fn: (data: any) => void) {
    const onceFn = (data: any) => {
      fn(data)
      this.off(name, onceFn)
    }
    this.on(name, onceFn)
    return this
  }

  emit(name: string, data?: any) {
    ;(this.events[name] || []).forEach(fn => fn(data))
    return this
  }

  off(name: string, fn: (data: any) => void) {
    const fns = this.events[name]
    if (!fns) {
      return
    }
    if (fn) {
      const index = fns.findIndex(f => f === fn)
      if (index > -1) {
        fns.splice(index, 1)
      }
    }
    else {
      delete this.events[name]
    }
    return this
  }
}
