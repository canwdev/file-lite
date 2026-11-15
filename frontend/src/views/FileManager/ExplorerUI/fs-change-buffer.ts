import type { FsDirChange, IEntry } from '@/types/server'

interface DirAccumulator {
  dir: string
  added: Map<string, IEntry>
  updated: Map<string, IEntry>
  removed: Set<string>
}

/**
 * Merge a burst of directory changes into one change per directory.
 *
 * The last operation wins per name, so a rename sequence such as
 * `remove a, add b` collapses to exactly that, while `add x, remove x`
 * collapses to a single removal (and an entry that only appeared in the burst
 * never reaches the list).
 */
export function mergeFsDirChanges(changes: FsDirChange[]): FsDirChange[] {
  const byDir = new Map<string, DirAccumulator>()
  const order: string[] = []

  function accumulator(dir: string): DirAccumulator {
    let current = byDir.get(dir)
    if (!current) {
      current = { dir, added: new Map(), updated: new Map(), removed: new Set() }
      byDir.set(dir, current)
      order.push(dir)
    }
    return current
  }

  for (const change of changes) {
    if (!change.dir)
      continue
    const acc = accumulator(change.dir)
    for (const name of change.removed ?? []) {
      acc.added.delete(name)
      acc.updated.delete(name)
      acc.removed.add(name)
    }
    for (const entry of change.added ?? []) {
      acc.removed.delete(entry.name)
      acc.updated.delete(entry.name)
      acc.added.set(entry.name, entry)
    }
    for (const entry of change.updated ?? []) {
      acc.removed.delete(entry.name)
      acc.added.delete(entry.name)
      acc.updated.set(entry.name, entry)
    }
  }

  const merged: FsDirChange[] = []
  for (const dir of order) {
    const acc = byDir.get(dir)!
    if (!acc.added.size && !acc.updated.size && !acc.removed.size)
      continue
    merged.push({
      dir,
      ...(acc.added.size ? { added: [...acc.added.values()] } : {}),
      ...(acc.updated.size ? { updated: [...acc.updated.values()] } : {}),
      ...(acc.removed.size ? { removed: [...acc.removed] } : {}),
    })
  }
  return merged
}
