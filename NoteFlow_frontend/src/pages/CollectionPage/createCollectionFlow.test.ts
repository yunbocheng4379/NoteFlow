import { strict as assert } from 'node:assert'
import {
  buildCollectionCreateNavigation,
  consumeCollectionCreateState,
} from './createCollectionFlow.ts'

const taskIds = ['task-1', 'task-2']

assert.deepEqual(consumeCollectionCreateState({ openCreate: true, taskIds }), {
  shouldOpen: true,
  taskIds,
})
assert.deepEqual(consumeCollectionCreateState(null), { shouldOpen: false, taskIds: [] })
assert.deepEqual(consumeCollectionCreateState({ openCreate: false, taskIds }), {
  shouldOpen: false,
  taskIds: [],
})
assert.deepEqual(buildCollectionCreateNavigation(['task-1']), {
  state: { openCreate: true, taskIds: ['task-1'] },
})
