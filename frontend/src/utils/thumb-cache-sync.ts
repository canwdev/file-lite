/**
 * Keeps the thumbnail cache pointing at files through path changes.
 *
 * Cache keys are absolute paths and the fingerprint is `(version, size, mtime)`, so:
 * - **move / rename** (mtime survives a same-filesystem rename) can rewrite a whole
 *   subtree to the new keys and keep hitting the old bytes;
 * - **copy / duplicate** keeps the source entries and writes a twin under the destination
 *   keys -- a copy preserves size and mtime too, so the twin hits instead of being generated
 *   again. Both cover the child entries a folder preview is made of;
 * - **delete** makes those bytes unreachable, so they are dropped right away instead of
 *   waiting for LRU eviction.
 *
 * This module only turns task results into the list of paths to reuse or drop (the pure
 * `thumbCacheSyncPlan`); reading and writing IndexedDB lives in `image-thumb-cache`.
 */
import type { TaskItemResult, TaskSnapshot } from '../types/server'
// Relative imports: `bun test` only reads the root tsconfig and cannot resolve Vite's `@/`
// alias, so these keep the module importable from a unit test (see image-thumb-cache).
import { copyImageThumbCache, deleteImageThumbCache, moveImageThumbCache } from './image-thumb-cache'
import { joinPath } from './path/form'

/**
 * Result statuses that mean the source entry now also lives at `toPath` through a move.
 *
 * `moved`: a plain move; `replaced`: it overwrote the destination, so the source bytes are
 * what sits at the destination path now; `renamed`: `keep-both` picked another name for the
 * landing spot.
 */
const RELOCATED_STATUSES = new Set(['moved', 'replaced', 'renamed'])

/** The same, for the copy-like tasks: the destination holds a second copy of the source. */
const COPIED_STATUSES = new Set(['copied', 'replaced', 'renamed'])

/** Task kinds whose destination gets its own copy of the source thumbnails. */
const COPY_KINDS = new Set(['copy', 'duplicate'])

/** A path pair for the cache: what is cached under `from` is reused under `to`. */
export interface ThumbCachePathPair {
  from: string
  to: string
}

/**
 * Thumbnail-cache maintenance for a finished task.
 *
 * `truncated` (the done message's `resultsTruncated`) means the result list was capped, so
 * the entry for a top-level folder may have been pushed out by its own children. Only a
 * fully successful task may then fall back to "it landed at the same name under `toPath`":
 * a partial task cannot tell "not reported" from "not carried out", and reusing less is
 * better than reusing the cache of an entry that never left its source.
 *
 * `duplicate` is excluded from that fallback: it names the new entry after the source
 * ("name - Copy"), so the name under `toPath` is not where it landed.
 */
export function thumbCacheSyncPlan(
  task: TaskSnapshot,
  results: TaskItemResult[],
  truncated: boolean,
): { moves: ThumbCachePathPair[], copies: ThumbCachePathPair[], removals: string[] } {
  const moves: ThumbCachePathPair[] = []
  const copies: ThumbCachePathPair[] = []
  const removals: string[] = []

  if (task.kind === 'delete') {
    const deleted = new Set<string>()
    for (const result of results) {
      if (result.status === 'deleted')
        deleted.add(result.fromPath)
    }
    // A delete reports one result per top-level entry; when that list was capped, a fully
    // successful task deleted all of them, so take them from fromPaths.
    if (truncated && task.state === 'succeeded') {
      for (const fromPath of task.fromPaths)
        deleted.add(fromPath)
    }
    removals.push(...deleted)
    return { moves, copies, removals }
  }

  const isCopy = COPY_KINDS.has(task.kind)
  if (!isCopy && task.kind !== 'move')
    return { moves, copies, removals }

  const pairs = isCopy ? copies : moves
  const statuses = isCopy ? COPIED_STATUSES : RELOCATED_STATUSES

  const listed = new Set<string>()
  for (const result of results) {
    if (!result.toPath || !statuses.has(result.status))
      continue
    listed.add(result.fromPath)
    pairs.push({ from: result.fromPath, to: result.toPath })
  }

  // A copy never reports the folder itself (only the files inside it), so a capped result
  // list leaves the whole folder to this derivation. A move does report the folder, so here
  // it only fills in whatever the cap dropped.
  const canDerive = task.kind === 'move' || task.kind === 'copy'
  if (truncated && task.state === 'succeeded' && task.toPath && canDerive) {
    for (const fromPath of task.fromPaths) {
      if (listed.has(fromPath))
        continue
      pairs.push({ from: fromPath, to: joinPath(task.toPath, baseName(fromPath)) })
    }
  }

  return { moves, copies, removals }
}

/** Last path segment (the name a top-level entry keeps under the destination folder). */
function baseName(path: string): string {
  const trimmed = path.replace(/\/+$/, '')
  const slash = trimmed.lastIndexOf('/')
  return slash < 0 ? trimmed : trimmed.slice(slash + 1)
}

/**
 * Applies the plan to the thumbnail cache. Task kinds other than move / copy / delete do
 * nothing.
 *
 * The caller only needs to have the task snapshot at hand once the task finishes (the done
 * branch of `store/tasks.ts`); whether an entry actually moved or copied is decided by its
 * result status, so failed, skipped and cancelled work never touches the cache by accident.
 */
export function syncImageThumbCacheWithTask(
  task: TaskSnapshot,
  results: TaskItemResult[],
  truncated: boolean,
): void {
  const { moves, copies, removals } = thumbCacheSyncPlan(task, results, truncated)
  for (const move of moves)
    void moveImageThumbCache(move.from, move.to)
  for (const copy of copies)
    void copyImageThumbCache(copy.from, copy.to)
  for (const path of removals)
    void deleteImageThumbCache(path)
}
