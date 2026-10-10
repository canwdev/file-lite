/**
 * Whether a popup layer — an Element Plus dialog / message box, or a vgo context menu — is
 * on screen right now.
 *
 * Element Plus teleports those layers to `<body>`, outside every `[data-shortcut-scope]`
 * element. A key pressed inside one of them therefore finds no scope of its own and falls
 * back to the active app window (see `resolveTargetScope` in `hooks/use-shortcut`), which is
 * how arrow keys, Delete and friends used to reach the page behind a confirmation dialog.
 * The shortcut layer skips its whole dispatch while one of these is open, so the dialog owns
 * the keyboard (the dialog's own widgets, and its own Esc handling, stay in charge).
 *
 * The layers stay in the DOM after closing (`display: none`), so each match is checked for
 * visibility.
 */
const POPUP_LAYER_SELECTOR = '.el-message-box, .el-overlay, .vgo-context-menu'

export function hasOpenPopupLayer(): boolean {
  if (typeof document === 'undefined')
    return false

  for (const node of document.querySelectorAll(POPUP_LAYER_SELECTOR)) {
    if (!(node instanceof HTMLElement))
      continue
    const style = getComputedStyle(node)
    if (style.display !== 'none' && style.visibility !== 'hidden')
      return true
  }
  return false
}
