(function () {
  var shown = false
  // 经典界面：服务端渲染的纯 HTML（/ie），老浏览器和关掉 JS 的浏览器都能用。
  var classicUrl = '/ie'

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

  // 链接带上原来的查询串，免得 ?ticket= 这类参数丢掉（/ie 自己也认票据）。
  function classicTarget() {
    return classicUrl + (window.location.search || '')
  }

  function showMessage(message, force) {
    var root = document.getElementById('app')
    var p, hint, link
    if (!root)
      return
    // force 的那条（老浏览器判定）比先前那条泛泛的报错更准确，允许它覆盖；
    // 其它情况只显示第一条。
    if (!force && (shown || window.__APP_READY__))
      return

    shown = true
    root.innerHTML = ''
    p = document.createElement('pre')
    p.style.paddingLeft = '20px'
    p.style.paddingRight = '20px'
    p.appendChild(document.createTextNode(message))
    root.appendChild(p)

    // 只给入口，不替用户跳走：5 秒那个定时器也可能只是"加载慢"，自动跳转会把
    // 一个其实还能用的页面抢走。
    hint = document.createElement('p')
    hint.style.paddingLeft = '20px'
    hint.style.paddingRight = '20px'
    link = document.createElement('a')
    link.href = classicTarget()
    link.appendChild(document.createTextNode('Open the classic interface'))
    hint.appendChild(link)
    hint.appendChild(document.createTextNode(' — it works in older browsers.'))
    root.appendChild(hint)
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
