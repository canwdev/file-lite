import type { TaskItemResult, TaskSnapshot } from '@/types/server'
import { describe, expect, test } from 'bun:test'
import { thumbCacheSyncPlan } from './thumb-cache-sync'

/**
 * "What to move, what to drop" for the thumbnail cache.
 *
 * The IndexedDB work itself lives in `image-thumb-cache.ts`; this only pins the mapping
 * from task results to actions: copies leave the cache alone, skipped / failed entries
 * leave it alone, and a capped result list is only extrapolated from a fully successful
 * task.
 */

function task(patch: Partial<TaskSnapshot>): TaskSnapshot {
  return {
    id: 't1',
    kind: 'move',
    state: 'succeeded',
    fromPaths: [],
    isMove: true,
    progress: { itemsTotal: 0, itemsDone: 0, bytesTotal: 0, bytesDone: 0 },
    stats: { succeeded: 0, skipped: 0, renamed: 0, failed: 0, conflict: 0 },
    canCancel: false,
    createdAt: 0,
    ...patch,
  }
}

function result(fromPath: string, status: TaskItemResult['status'], toPath?: string): TaskItemResult {
  return { fromPath, toPath, status }
}

describe('thumbCacheSyncPlan: move / rename', () => {
  test('relocated entries are rekeyed to the landing spot from the result', () => {
    const plan = thumbCacheSyncPlan(task({ toPath: '/dst/' }), [
      result('/src/a.jpg', 'moved', '/dst/a.jpg'),
      // keep-both picked another name: the result has the real landing spot
      result('/src/b.jpg', 'renamed', '/dst/b - Copy.jpg'),
    ], false)

    expect(plan.moves).toEqual([
      { from: '/src/a.jpg', to: '/dst/a.jpg' },
      { from: '/src/b.jpg', to: '/dst/b - Copy.jpg' },
    ])
    expect(plan.removals).toEqual([])
  })

  test('skipped and failed entries stay put', () => {
    const plan = thumbCacheSyncPlan(task({ toPath: '/dst/', state: 'partial' }), [
      result('/src/a.jpg', 'skipped', '/dst/a.jpg'),
      result('/src/b.jpg', 'failed'),
      result('/src/c.jpg', 'copied', '/dst/c.jpg'),
    ], false)

    expect(plan.moves).toEqual([])
  })

  test('a copy result never counts as a move', () => {
    const plan = thumbCacheSyncPlan(task({ toPath: '/dst/', state: 'partial' }), [
      result('/src/a.jpg', 'copied', '/dst/a.jpg'),
    ], false)

    expect(plan.moves).toEqual([])
    expect(plan.copies).toEqual([])
  })

  test('capped results + fully successful task: unlisted entries are derived under toPath', () => {
    const plan = thumbCacheSyncPlan(task({
      state: 'succeeded',
      toPath: '/dst/',
      fromPaths: ['/src/a.jpg', '/src/photos'],
    }), [
      result('/src/a.jpg', 'moved', '/dst/a.jpg'),
    ], true)

    expect(plan.moves).toEqual([
      { from: '/src/a.jpg', to: '/dst/a.jpg' },
      { from: '/src/photos', to: '/dst/photos' },
    ])
  })

  test('capped results on a partial task: nothing is derived', () => {
    const plan = thumbCacheSyncPlan(task({
      state: 'partial',
      toPath: '/dst/',
      fromPaths: ['/src/a.jpg', '/src/b.jpg'],
    }), [
      result('/src/a.jpg', 'moved', '/dst/a.jpg'),
    ], true)

    expect(plan.moves).toEqual([{ from: '/src/a.jpg', to: '/dst/a.jpg' }])
  })

  test('a complete result list derives nothing: no result means no move', () => {
    const plan = thumbCacheSyncPlan(task({
      state: 'succeeded',
      toPath: '/dst/',
      fromPaths: ['/src/a.jpg', '/src/b.jpg'],
    }), [
      result('/src/a.jpg', 'moved', '/dst/a.jpg'),
    ], false)

    expect(plan.moves).toEqual([{ from: '/src/a.jpg', to: '/dst/a.jpg' }])
  })
})

describe('thumbCacheSyncPlan: copy / duplicate', () => {
  test('copied entries keep the source cache and add a twin at the destination', () => {
    const plan = thumbCacheSyncPlan(task({ kind: 'copy', isMove: false, toPath: '/dst/' }), [
      result('/src/a.jpg', 'copied', '/dst/a.jpg'),
      // keep-both renamed the incoming copy: the result holds the real name
      result('/src/b.jpg', 'renamed', '/dst/b - Copy.jpg'),
    ], false)

    expect(plan.copies).toEqual([
      { from: '/src/a.jpg', to: '/dst/a.jpg' },
      { from: '/src/b.jpg', to: '/dst/b - Copy.jpg' },
    ])
    expect(plan.moves).toEqual([])
    expect(plan.removals).toEqual([])
  })

  test('a skipped copy leaves the cache untouched', () => {
    const plan = thumbCacheSyncPlan(task({ kind: 'copy', isMove: false, state: 'partial' }), [
      result('/src/a.jpg', 'skipped', '/dst/a.jpg'),
      result('/src/b.jpg', 'failed'),
    ], false)

    expect(plan.copies).toEqual([])
  })

  test('duplicate uses the new name from the result', () => {
    const plan = thumbCacheSyncPlan(task({
      kind: 'duplicate',
      isMove: false,
      toPath: '/src/',
    }), [
      result('/src/a.jpg', 'copied', '/src/a - Copy.jpg'),
    ], false)

    expect(plan.copies).toEqual([{ from: '/src/a.jpg', to: '/src/a - Copy.jpg' }])
  })

  test('capped results + fully successful copy: the folder itself is derived under toPath', () => {
    const plan = thumbCacheSyncPlan(task({
      kind: 'copy',
      isMove: false,
      state: 'succeeded',
      toPath: '/dst/',
      fromPaths: ['/src/photos', '/src/a.jpg'],
    }), [
      // a folder copy reports its files, never the folder itself
      result('/src/photos/x.jpg', 'copied', '/dst/photos/x.jpg'),
      result('/src/a.jpg', 'copied', '/dst/a.jpg'),
    ], true)

    expect(plan.copies).toEqual([
      { from: '/src/photos/x.jpg', to: '/dst/photos/x.jpg' },
      { from: '/src/a.jpg', to: '/dst/a.jpg' },
      { from: '/src/photos', to: '/dst/photos' },
    ])
  })

  test('duplicate never derives: its destination name comes from the source name', () => {
    const plan = thumbCacheSyncPlan(task({
      kind: 'duplicate',
      isMove: false,
      state: 'succeeded',
      toPath: '/src/',
      fromPaths: ['/src/photos'],
    }), [], true)

    expect(plan.copies).toEqual([])
  })
})

describe('thumbCacheSyncPlan: delete', () => {
  test('only the entries that were really deleted are dropped', () => {
    const plan = thumbCacheSyncPlan(task({ kind: 'delete', isMove: false, state: 'partial' }), [
      result('/src/a.jpg', 'deleted'),
      result('/src/photos', 'failed'),
    ], false)

    expect(plan.removals).toEqual(['/src/a.jpg'])
    expect(plan.moves).toEqual([])
  })

  test('capped results + fully successful task: every fromPath is dropped', () => {
    const plan = thumbCacheSyncPlan(task({
      kind: 'delete',
      isMove: false,
      state: 'succeeded',
      fromPaths: ['/src/a.jpg', '/src/photos'],
    }), [
      result('/src/a.jpg', 'deleted'),
    ], true)

    expect(plan.removals).toEqual(['/src/a.jpg', '/src/photos'])
  })

  test('a cancelled delete only drops what the results report as deleted', () => {
    const plan = thumbCacheSyncPlan(task({
      kind: 'delete',
      isMove: false,
      state: 'cancelled',
      fromPaths: ['/src/a.jpg', '/src/photos'],
    }), [
      result('/src/a.jpg', 'deleted'),
    ], true)

    expect(plan.removals).toEqual(['/src/a.jpg'])
  })
})
