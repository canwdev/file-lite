(function () {
  var shown = false

  function getUnsupportedReason() {
    var ua = navigator.userAgent || ''
    if (!window.Promise || !window.Symbol || !window.Map || !window.Set || !window.Proxy || !window.WebSocket)
      return 'This browser is missing required JavaScript features.'
    var script = document.createElement('script')
    if (!('noModule' in script))
      return 'This browser is not supported modern web features.'
    return ''
  }

  function getError(event) {
    var err = event && (event.reason || event.error || event.message)
    return err ? (err.message || String(err)) : 'Unknown error'
  }

  function showMessage(message, force) {
    var root = document.getElementById('app')
    var p
    if (shown || (!force && window.__APP_READY__) || !root)
      return

    shown = true
    root.innerHTML = ''
    p = document.createElement('pre')
    p.style.paddingLeft = '20px'
    p.style.paddingRight = '20px'
    p.appendChild(document.createTextNode(message))
    root.appendChild(p)
  }

  function showError(event) {
    showMessage('Page Error: ' + getError(event), false)
  }

  function showUnsupported() {
    var reason = getUnsupportedReason()
    if (reason)
      showMessage('Unsupported Browser: ' + reason, true)
  }

  if (window.addEventListener) {
    window.addEventListener('DOMContentLoaded', showUnsupported, false)
    window.addEventListener('error', showError, true)
    window.addEventListener('unhandledrejection', showError, true)
  }
  else if (window.attachEvent) {
    window.attachEvent('onload', showUnsupported)
    window.attachEvent('onerror', showError)
  }

  window.setTimeout(showUnsupported, 0)
  window.setTimeout(showError, 5000)
}())
