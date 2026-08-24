export interface CollectionCreateNavigationState {
  openCreate: true
  taskIds: string[]
}

export interface CollectionCreateNavigation {
  state: CollectionCreateNavigationState
}

export function consumeCollectionCreateState(
  state: unknown,
): { shouldOpen: boolean; taskIds: string[] } {
  if (!state || typeof state !== 'object') return { shouldOpen: false, taskIds: [] }

  const candidate = state as { openCreate?: unknown; taskIds?: unknown }
  if (candidate.openCreate !== true || !Array.isArray(candidate.taskIds)) {
    return { shouldOpen: false, taskIds: [] }
  }

  return {
    shouldOpen: true,
    taskIds: candidate.taskIds.filter((taskId): taskId is string => typeof taskId === 'string'),
  }
}

export function buildCollectionCreateNavigation(taskIds: string[]): CollectionCreateNavigation {
  return {
    state: { openCreate: true, taskIds: [...taskIds] },
  }
}
