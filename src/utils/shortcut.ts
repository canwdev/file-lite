import readline from 'readline'
import process from 'node:process'

export interface IShortcuts {
  key?: string
  desc?: string
  callback?: () => void
  split?: boolean
}

const printShortcuts = async (
  shortcuts: IShortcuts[] = [],
  printCallback?: () => Promise<void>,
) => {
  console.log('\nShortcuts:')
  for (const {key, desc, split} of shortcuts) {
    const line = split ? '' : `  ${key} + Enter: ${desc}`
    console.log(line)
  }
  if (printCallback) {
    await printCallback()
  } else {
    console.log('\n')
  }
}

export const registerShortcuts = async (options: {
  shortcuts: IShortcuts[]
  printCallback?: () => Promise<void>
}) => {
  const {shortcuts = [], printCallback} = options

  // 创建readline接口
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })
  rl.on('line', async (input) => {
    input = input.trim().toLowerCase()
    // console.log('onInput', input)
    const shortcut = shortcuts.find((item) => item.key === input)
    if (shortcut) {
      console.log(`\n  ${shortcut.desc}\n`)
      shortcut.callback && shortcut.callback()
    } else {
      console.log(`\n  Invalid shortcut: ${input}\n`)
      await printShortcuts(shortcuts, printCallback)
    }
    rl.prompt() // 重新显示提示符
  })

  await printShortcuts(shortcuts, printCallback)

  rl.prompt() // 显示提示符，开始等待用户输入
  return rl
}
