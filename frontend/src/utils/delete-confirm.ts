/**
 * The shared "Confirm Delete" dialog.
 *
 * The body is a VNode with every name in bold (a folder in the danger colour, since it
 * takes its contents with it) and at most `DELETE_CONFIRM_MAX_NAMES` names listed. It is
 * built from text children rather than an HTML string, so a name that looks like markup
 * stays literal text.
 */
import type { VNode } from 'vue'
import { h } from 'vue'

/** How many names the dialog lists before it summarises the rest. */
export const DELETE_CONFIRM_MAX_NAMES = 5

export interface DeleteConfirmTarget {
  name: string
  isDirectory: boolean
}

/** Body of the delete confirmation: the count, then the names themselves, one per line. */
export function deleteConfirmMessage(targets: DeleteConfirmTarget[]): VNode {
  const shown = targets.slice(0, DELETE_CONFIRM_MAX_NAMES)
  const hidden = targets.length - shown.length

  const nodes: VNode[] = [
    h('div', $t('file_lite_i18n.are_you_sure_to_delete_0_items_t', [targets.length])),
    ...shown.map(target => h('div', h('strong', {
      style: target.isDirectory ? 'color: var(--vgo-danger);' : undefined,
    }, target.name))),
  ]
  if (hidden > 0) {
    nodes.push(h('div', `and ${hidden} more item${hidden > 1 ? 's' : ''}`))
  }

  // overflow-wrap is inherited, so one declaration keeps long names inside the dialog
  return h('div', {
    style: 'display: flex; flex-direction: column; gap: var(--vgo-space-2); overflow-wrap: anywhere;',
  }, nodes)
}

/**
 * Ask before deleting these entries.
 *
 * @returns true when the user confirmed, false when the dialog was cancelled or closed.
 */
export async function confirmDeleteDialog(targets: DeleteConfirmTarget[]): Promise<boolean> {
  if (!targets.length) {
    return false
  }
  try {
    await window.$dialog.confirm(deleteConfirmMessage(targets), $t('file_lite_i18n.confirm'), {
      type: 'warning',
    })
    return true
  }
  catch {
    return false
  }
}
