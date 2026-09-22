const PREVIEW_LOAD_CONCURRENCY = 5

type PreviewLoadState = 'pending' | 'active' | 'done'

interface PreviewLoadTask {
  state: PreviewLoadState
  start: () => void
}

const pendingPreviewLoadTasks: PreviewLoadTask[] = []
let activePreviewLoadCount = 0

function flushPreviewLoadQueue() {
  while (activePreviewLoadCount < PREVIEW_LOAD_CONCURRENCY) {
    const task = pendingPreviewLoadTasks.shift()
    if (!task)
      return
    if (task.state !== 'pending')
      continue

    task.state = 'active'
    activePreviewLoadCount += 1
    task.start()
  }
}

function finishPreviewLoadTask(task: PreviewLoadTask) {
  if (task.state === 'done')
    return

  if (task.state === 'pending') {
    const index = pendingPreviewLoadTasks.indexOf(task)
    if (index !== -1)
      pendingPreviewLoadTasks.splice(index, 1)
  }
  else if (task.state === 'active') {
    activePreviewLoadCount = Math.max(0, activePreviewLoadCount - 1)
  }

  task.state = 'done'
  flushPreviewLoadQueue()
}

export function requestPreviewLoad(onStart: () => void) {
  const task: PreviewLoadTask = {
    state: 'pending',
    start: onStart,
  }

  pendingPreviewLoadTasks.push(task)
  flushPreviewLoadQueue()

  return () => finishPreviewLoadTask(task)
}
