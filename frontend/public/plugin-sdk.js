/* File Lite plugin SDK. Injected into a plugin's entry HTML. */
(function () {
  var PLUGIN = 'file-lite-plugin'
  var HOST = 'file-lite-host'
  var nextId = 0
  var pending = new Map()
  var openHandlers = []

  function post(message) {
    window.parent.postMessage(message, window.location.origin)
  }

  function call(method, fields) {
    var id = ++nextId
    return new Promise(function (resolve, reject) {
      pending.set(id, { resolve: resolve, reject: reject })
      var message = { source: PLUGIN, id: id, method: method }
      if (fields) {
        Object.keys(fields).forEach(function (key) {
          message[key] = fields[key]
        })
      }
      post(message)
    })
  }

  function toArrayBuffer(data) {
    if (data instanceof ArrayBuffer)
      return Promise.resolve(data)
    if (ArrayBuffer.isView(data)) {
      return Promise.resolve(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength))
    }
    if (data instanceof Blob)
      return data.arrayBuffer()
    return Promise.reject(new Error('unsupported data'))
  }

  window.addEventListener('message', function (event) {
    if (event.origin !== window.location.origin)
      return
    var data = event.data
    if (!data || data.source !== HOST)
      return
    if (data.event === 'open') {
      var file = data.path
        ? { path: data.path, filename: data.filename || '' }
        : undefined
      openHandlers.forEach(function (cb) {
        cb(file)
      })
      return
    }
    var waiter = pending.get(data.id)
    if (!waiter)
      return
    pending.delete(data.id)
    if (data.error)
      waiter.reject(new Error(data.error))
    else
      waiter.resolve(data.data)
  })

  window.fileLiteSDK = {
    list: function (path) {
      return call('list', { path: path })
    },
    readFile: function (path) {
      return call('readFile', { path: path })
    },
    writeFile: function (path, data) {
      return toArrayBuffer(data).then(function (buffer) {
        return call('writeFile', { path: path, data: buffer })
      })
    },
    onOpen: function (cb) {
      openHandlers.push(cb)
    },
    exit: function () {
      return call('exit')
    },
    setTitle: function (title) {
      return call('setTitle', { title: title })
    },
  }

  window.close = function () {
    window.fileLiteSDK.exit()
  }
})()
