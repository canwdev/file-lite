function getNameSelectionEnd(name: string) {
  const dotIndex = name.lastIndexOf('.')
  return dotIndex > 0 ? dotIndex : name.length
}

function findMessageBoxInput() {
  const box = document.querySelector('.el-message-box')
  if (!box) {
    return null
  }
  return box.querySelector('input, textarea') as HTMLInputElement | HTMLTextAreaElement | null
}

function applyPromptNameSelection(initialValue: string) {
  let attempts = 0
  const maxAttempts = 30

  const apply = (input: HTMLInputElement | HTMLTextAreaElement) => {
    const end = getNameSelectionEnd(input.value || initialValue)
    input.focus()
    input.setSelectionRange(0, end)
  }

  const trySelect = () => {
    const input = findMessageBoxInput()
    if (!input) {
      if (++attempts < maxAttempts) {
        requestAnimationFrame(trySelect)
      }
      return
    }

    apply(input)
    // Focus trap may reset selection after the dialog opens.
    setTimeout(() => apply(input), 0)
    setTimeout(() => apply(input), 50)
  }

  requestAnimationFrame(trySelect)
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
  // 聚焦时仅选中主文件名（不含扩展名）
  selectNameOnly?: boolean
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
    selectNameOnly = false,
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

    if (selectNameOnly) {
      applyPromptNameSelection(value)
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
