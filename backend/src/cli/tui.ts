import type { CmdCtx } from './commands'
import { PKG_NAME, VERSION } from '@frontend/enum/version.ts'
import enquirer from 'enquirer'
import { commands } from './commands'

export async function runTui(getCtx: () => CmdCtx, shouldContinue: () => boolean) {
  while (shouldContinue()) {
    const ctx = getCtx()
    const choices = commands
      .filter(cmd => cmd.when?.(ctx) ?? true)
      .map(cmd => ({ message: cmd.label, name: cmd.id }))

    const { selectedId }: { selectedId: string } = await enquirer.prompt([{
      type: 'select',
      name: 'selectedId',
      message: `${PKG_NAME} v${VERSION} Select function`,
      choices,
    }])

    const cmd = commands.find(item => item.id === selectedId)
    if (cmd) {
      await cmd.run(getCtx())
    }
  }
}
