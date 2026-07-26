import type { StartServerResult } from '@/app/server'
import { openIpSelector } from '@/app/server'
import { internalConfig } from '@/config/config'
import { opener } from '@/utils/server-utils.ts'

export interface CmdCtx {
  serverResult?: StartServerResult
  createConfigAndReload: () => Promise<void>
  reload: () => Promise<void>
  exit: () => Promise<void>
}

export interface Command {
  id: string
  label: string
  when?: (ctx: CmdCtx) => boolean
  run: (ctx: CmdCtx) => Promise<void>
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export const commands: Command[] = [
  {
    id: 'open-ip',
    label: 'Open IP selector',
    when: ctx => Boolean(ctx.serverResult),
    async run(ctx) {
      if (ctx.serverResult) {
        await openIpSelector(ctx.serverResult)
      }
      await sleep(1000)
    },
  },
  {
    id: 'print-urls',
    label: 'Print urls',
    when: ctx => Boolean(ctx.serverResult),
    async run(ctx) {
      console.clear()
      ctx.serverResult?.printUrls()
    },
  },
  {
    id: 'create-config',
    label: 'Create config file',
    when: () => !internalConfig.configInitialized,
    async run(ctx) {
      await ctx.createConfigAndReload()
    },
  },
  {
    id: 'open-config',
    label: 'Open config file',
    when: () => internalConfig.configInitialized,
    async run() {
      if (internalConfig.configInitialized) {
        await opener(internalConfig.configFilePath)
      }
    },
  },
  {
    id: 'reload',
    label: 'Restart server',
    when: ctx => Boolean(ctx.serverResult),
    async run(ctx) {
      console.clear()
      await ctx.reload()
    },
  },
  {
    id: 'exit',
    label: 'Exit',
    async run(ctx) {
      await ctx.exit()
    },
  },
]
