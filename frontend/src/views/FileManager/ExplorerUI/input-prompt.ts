export type NameFieldSelection = 'all' | 'stem'

type NameField = HTMLInputElement | HTMLTextAreaElement

function selectionEnd(value: string, selection: NameFieldSelection) {
  if (selection === 'all')
    return value.length
  const dot = value.lastIndexOf('.')
  return dot > 0 ? dot : value.length
}

function anotherFieldIsActive(input: NameField) {
  const active = document.activeElement
  const box = input.closest('.el-message-box')
  return active instanceof HTMLElement
    && !!box?.contains(active)
    && active !== input
    && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')
}

function applyNameSelection(input: NameField, selection: NameFieldSelection) {
  input.focus()
  if (document.activeElement !== input)
    return false
  input.setSelectionRange(0, selectionEnd(input.value, selection))
  return true
}

function restoreNameSelection(input: NameField, selection: NameFieldSelection) {
  if (!input.isConnected || document.activeElement !== input)
    return
  input.setSelectionRange(0, selectionEnd(input.value, selection))
}

function attemptNameFocus(input: NameField, selection: NameFieldSelection, retry: boolean) {
  if (!input.isConnected || anotherFieldIsActive(input))
    return
  if (!applyNameSelection(input, selection)) {
    if (retry)
      setTimeout(attemptNameFocus, 0, input, selection, false)
    return
  }
  // The focus trap may focus the field again and drop the selection.
  // Restore it once, and only while this field is still the active one.
  if (retry)
    setTimeout(restoreNameSelection, 0, input, selection)
}

/**
 * Focus a message-box field and select its text.
 * A confirm box focuses its button; this runs after that trap, then stops.
 * It does not pull the caret back once another field in the box is active.
 */
export function focusNameField(input: NameField, selection: NameFieldSelection = 'stem') {
  setTimeout(attemptNameFocus, 0, input, selection, true)
}

function whenMessageBoxFieldReady(apply: (input: NameField) => void) {
  let attempts = 0
  const find = () => {
    const input = document.querySelector('.el-message-box input, .el-message-box textarea')
    if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) {
      apply(input)
      return
    }
    if (++attempts < 30)
      requestAnimationFrame(find)
  }
  requestAnimationFrame(find)
}

export function showInputPrompt(options: {
  // 弹窗标题
  title?: string
  // 文本框预设内容
  value?: string
  // 文本框占位符
  placeholder?: string
  // 返回错误字符串表示错误，否则校验成功
  validateFn?: (val: string) => string | void
  // 文本框类型
  type?: 'text' | 'number'
  // 是否允许空
  allowEmpty?: boolean
  // Focus the field and select its text. `all` selects everything; `stem` stops before the last dot.
  selectOnFocus?: NameFieldSelection
} = {}): Promise<string> {
  const {
    // 弹窗标题
    title = '',
    // 文本框预设内容
    value = '',
    // 文本框占位符
    placeholder = '',
    // 返回错误字符串表示错误，否则校验成功
    validateFn,
    // 文本框类型
    type = 'text',
    // 是否允许空
    allowEmpty = false,
    selectOnFocus,
  } = options

  return new Promise<string>((resolve, reject) => {
    const dialogPromise = window.$dialog.prompt(placeholder, title, {
      inputType: type,
      inputValue: value,
      inputValidator: (val: string) => {
        if (!allowEmpty && val === '') {
          return 'input value is required'
        }
        if (validateFn) {
          return validateFn(val)
        }
      },
      confirmButtonText: 'OK',
      cancelButtonText: 'Cancel',
    })

    if (selectOnFocus) {
      whenMessageBoxFieldReady(input => focusNameField(input, selectOnFocus))
    }

    dialogPromise
      .then((res: { value: string }) => {
        resolve(res.value)
      })
      .catch((e: unknown) => {
        reject(e)
      })
  })
}
