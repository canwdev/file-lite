import type { Component } from 'vue'
import type { AppChrome, AppLaunchTarget, AppListItem, AppName, InternalAppListItem } from './apps'
import type { PluginInfo } from '@/api/plugins'
import { AppList, appMetaByName, InternalAppList, isBuiltinApp } from './apps'

/**
 * One thing that can own an app window, whether its implementation is a Vue
 * component in this window (built-in) or a plugin page in an iframe.
 *
 * The target keeps a reference rather than a copy of the metadata so the menu
 * label and icon follow the current language and the latest plugin scan.
 */
export type AppTarget
  = | { kind: 'builtin', appName: AppName }
    | { kind: 'plugin', plugin: PluginInfo }

export type BuiltinAppTarget = Extract<AppTarget, { kind: 'builtin' }>
export type PluginAppTarget = Extract<AppTarget, { kind: 'plugin' }>

export function builtinTarget(appName: AppName): BuiltinAppTarget {
  return { kind: 'builtin', appName }
}

export function pluginTarget(plugin: PluginInfo): PluginAppTarget {
  return { kind: 'plugin', plugin }
}

/** The plugin behind a target, or `undefined` for a built-in app. */
export function pluginOf(target: AppTarget): PluginInfo | undefined {
  return target.kind === 'plugin' ? target.plugin : undefined
}

/** The built-in app name behind a target, or `undefined` for a plugin. */
export function builtinAppOf(target: AppTarget): AppName | undefined {
  return target.kind === 'builtin' ? target.appName : undefined
}

export function targetId(target: AppTarget): string {
  return target.kind === 'builtin' ? target.appName : target.plugin.id
}

export function targetName(target: AppTarget): string {
  if (target.kind === 'plugin') {
    return target.plugin.name
  }
  return appMetaByName[target.appName]?.name ?? target.appName
}

export function targetIcon(target: AppTarget): string | undefined {
  return target.kind === 'builtin' ? appMetaByName[target.appName]?.icon : undefined
}

/** The Vue component behind a built-in target; `undefined` if it was never registered. */
export function targetComponent(target: BuiltinAppTarget): Component | undefined {
  return (appMetaByName[target.appName] as AppListItem | InternalAppListItem | undefined)?.component
}

export function targetSingleInstance(target: AppTarget): boolean {
  if (target.kind === 'plugin') {
    return target.plugin.singleInstance
  }
  return appMetaByName[target.appName]?.singleInstance ?? false
}

export function targetChrome(target: AppTarget): AppChrome | undefined {
  return target.kind === 'builtin' ? appMetaByName[target.appName]?.chrome : undefined
}

export function targetVersion(target: AppTarget): string | undefined {
  return target.kind === 'plugin' ? target.plugin.version || undefined : undefined
}

/** The built-in entries offered by "Open With" and "Set Default App". */
export function builtinOpenWithTargets(): BuiltinAppTarget[] {
  return AppList.map(app => builtinTarget(app.openWith))
}

/** The selection kinds an app accepts from the explorer's context menu. */
export function targetLaunchTargets(target: AppTarget): AppLaunchTarget[] {
  if (target.kind === 'plugin') {
    return (target.plugin.launchTargets ?? []) as AppLaunchTarget[]
  }
  return appMetaByName[target.appName]?.launchTargets ?? []
}

/** Built-in and plugin apps that accept the given explorer selection. */
export function targetsForSelection(
  kind: AppLaunchTarget,
  plugins: readonly PluginInfo[],
): AppTarget[] {
  const builtins: AppTarget[] = [...AppList, ...InternalAppList]
    .filter(item => (item.launchTargets ?? []).includes(kind))
    .map(item => builtinTarget('openWith' in item ? item.openWith : item.appName))
  const pluginApps: AppTarget[] = plugins
    .filter(plugin => (plugin.launchTargets ?? []).includes(kind))
    .map(pluginTarget)
  return [...builtins, ...pluginApps]
}

/** Every plugin from the current scan, including ones without `openWith`. */
export function pluginTargets(plugins: readonly PluginInfo[]): PluginAppTarget[] {
  return plugins.map(pluginTarget)
}

/** Only plugins that can open a file (`openWith` is non-empty). */
export function pluginOpenWithTargets(plugins: readonly PluginInfo[]): PluginAppTarget[] {
  return plugins.filter(plugin => plugin.openWith.length > 0).map(pluginTarget)
}

/** Resolve a stored app id (built-in open-with name or plugin id) to its target. */
export function findTarget(id: string, plugins: readonly PluginInfo[]): AppTarget | undefined {
  // Internal apps are menu-launched only: they never become Open With targets.
  if (isBuiltinApp(id)) {
    return builtinTarget(id)
  }
  const plugin = plugins.find(entry => entry.id === id)
  return plugin ? pluginTarget(plugin) : undefined
}
