/* File Lite plugin SDK. Injected into a plugin's entry HTML. */
(function () {
  var VERSION = 2
  var STREAM_URL_PREFIX = '/api/fs/content/'
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

  function dispatchOpen(data) {
    var file = data.path
      ? { path: data.path, filename: data.filename || '', directory: data.directory || '' }
      : undefined
    openHandlers.forEach(function (cb) {
      cb(file)
    })
  }

  window.addEventListener('message', function (event) {
    if (event.origin !== window.location.origin)
      return
    var data = event.data
    if (!data || data.source !== HOST)
      return
    if (data.event === 'open') {
      dispatchOpen(data)
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
    version: VERSION,
    list: function (path) {
      return call('list', { path: path })
    },
    readFile: function (path) {
      return call('readFile', { path: path })
    },
    readText: function (path) {
      return call('readText', { path: path })
    },
    writeFile: function (path, data, options) {
      // Only clone-safe fields travel over postMessage; callbacks stay host-side.
      var writeOptions = options
        ? { conflict: options.conflict, charset: options.charset }
        : undefined
      return toArrayBuffer(data).then(function (buffer) {
        return call('writeFile', { path: path, data: buffer, options: writeOptions })
      })
    },
    pick: function (options) {
      return call('pick', { pick: options })
    },
    url: function (path) {
      return path ? STREAM_URL_PREFIX + encodeURIComponent(path) : ''
    },
    // Same-origin fetch of the stream URL: the body is a ReadableStream and Range
    // requests work, so large files can be read in chunks.
    stream: function (path, options) {
      return fetch(STREAM_URL_PREFIX + encodeURIComponent(path), {
        credentials: 'same-origin',
        signal: options && options.signal,
      })
    },
    getLaunch: function () {
      return call('getLaunch')
    },
    onOpen: function (cb) {
      openHandlers.push(cb)
    },
    updateLaunch: function (launch) {
      return call('updateLaunch', { launch: launch })
    },
    exit: function () {
      return call('exit')
    },
    setTitle: function (title) {
      return call('setTitle', { title: title })
    },
    selectItems: function (names) {
      return call('selectItems', { names: names })
    },
    revealItem: function (name) {
      return call('revealItem', { name: name })
    },
  }

  window.close = function () {
    window.fileLiteSDK.exit()
  }
})()
