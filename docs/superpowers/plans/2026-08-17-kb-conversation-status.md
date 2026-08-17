# Knowledge Base Conversation Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-conversation transient execution indicators and context-aware unread markers to the knowledge-base history list without changing the backend SSE contract or database schema.

**Architecture:** Keep execution state and in-flight assistant drafts in the Zustand knowledge-base store, keyed by conversation ID and therefore scoped to the current browser tab. Route every stream callback through target-aware store actions; active conversations update the visible message list, while inactive conversations update only their draft. On terminal completion, persist `is_unread` only when the target conversation is no longer active.

**Tech Stack:** React 19, TypeScript, Zustand, Tailwind CSS, `lucide-react`, existing `/kb/ask_stream` SSE client and `is_unread` conversation API.

## Global Constraints

- Do not add database columns or change backend knowledge-base routes/SSE event types.
- Execution state and streaming drafts are transient and must not be persisted to localStorage or IndexedDB.
- Existing manual unread, pin, rename, delete, active-selection, and conversation sorting behavior must continue to work.
- Spinner is shown before the unread dot; the unread dot is only automatic when a terminal result occurs after the user leaves the conversation.
- Frontend verification runs from `NoteFlow_frontend/` with `pnpm build` and `pnpm lint`; there is no configured frontend unit-test runner.
- Preserve unrelated user changes already present in the worktree.

## File Map

- Modify `NoteFlow_frontend/src/store/knowledgeBaseStore/index.ts`: add transient per-conversation processing/draft state, target-aware stream actions, safe selection overlay, and cleanup on completion/deletion.
- Modify `NoteFlow_frontend/src/pages/KnowledgeBasePage/index.tsx`: wire stream callbacks to the target-aware store actions and render the spinner/unread status slot.
- No service or backend files are required because `askKbStream` and `updateConversation` already expose the needed interfaces.

### Task 1: Add target-aware transient state to the knowledge-base store

**Files:**
- Modify: `/Users/Zhuanz/Documents/prank/BiliNote/NoteFlow_frontend/src/store/knowledgeBaseStore/index.ts`

**Interfaces:**
- Add `KbStreamingDraft` with `content: string`, `reasoning_content: string`, and `sources: KbSource[]`.
- Add store state `processingConversationIds: Record<number, true>` and `streamingDrafts: Record<number, KbStreamingDraft>`.
- Add actions:
  - `startConversationStream(id: number): void`
  - `appendConversationMessage(id: number, text: string): void`
  - `appendConversationReasoning(id: number, text: string): void`
  - `setConversationSources(id: number, sources: KbSource[]): void`
  - `finishConversationStream(id: number): Promise<void>`

- [ ] **Step 1: Extend the store types and initial state.**

Add the following type and interface members next to the existing knowledge-base message state:

```ts
interface KbStreamingDraft {
  content: string
  reasoning_content: string
  sources: KbSource[]
}

interface KnowledgeBaseStore {
  // existing fields...
  processingConversationIds: Record<number, true>
  streamingDrafts: Record<number, KbStreamingDraft>
  startConversationStream: (id: number) => void
  appendConversationMessage: (id: number, text: string) => void
  appendConversationReasoning: (id: number, text: string) => void
  setConversationSources: (id: number, sources: KbSource[]) => void
  finishConversationStream: (id: number) => Promise<void>
}
```

Initialize both maps as `{}` in the store object. These maps must not be included in any persistence middleware.

- [ ] **Step 2: Implement stream start and draft update actions.**

`startConversationStream` must set the processing flag and replace any stale draft for the same ID with an empty draft:

```ts
startConversationStream: id =>
  set(state => ({
    processingConversationIds: { ...state.processingConversationIds, [id]: true },
    streamingDrafts: {
      ...state.streamingDrafts,
      [id]: { content: '', reasoning_content: '', sources: [] },
    },
  })),
```

Each target-aware append action must update the draft even when the target conversation is inactive. If the target is active, also update the visible assistant message. When the visible list has no assistant as its last message, append an assistant message rather than appending to the user message:

```ts
const updateVisibleAssistant = (
  messages: KbMessage[],
  update: (message: KbMessage) => KbMessage
): KbMessage[] => {
  const last = messages[messages.length - 1]
  if (!last || last.role !== 'assistant') {
    return [...messages, update({ role: 'assistant', content: '' })]
  }
  return [...messages.slice(0, -1), update(last)]
}
```

Use `updateVisibleAssistant` inside the actions so `appendConversationMessage(id, text)` appends to `content`, `appendConversationReasoning(id, text)` appends to `reasoning_content`, and `setConversationSources(id, sources)` replaces `sources` in the target draft and visible assistant message. For inactive targets, only `streamingDrafts[id]` changes.

- [ ] **Step 3: Make selection safe and overlay an active draft.**

Keep the existing optimistic active-ID update and unread clearing. After `getConversationMessages(id)` resolves, first check `get().activeConversationId === id`; if the user has already selected another conversation, discard that response. When the target is still active, append the current `streamingDrafts[id]` as an assistant message if `processingConversationIds[id]` is true:

```ts
const draft = get().streamingDrafts[id]
const isProcessing = !!get().processingConversationIds[id]
if (get().activeConversationId !== id) return
set({
  messages:
    isProcessing && draft
      ? [
          ...messages,
          {
            role: 'assistant',
            content: draft.content,
            reasoning_content: draft.reasoning_content,
            sources: draft.sources,
          },
        ]
      : messages,
})
```

This overlay is only for an in-flight request; completed drafts are removed before the target can be reloaded from the backend.

- [ ] **Step 4: Implement terminal cleanup and context-aware unread persistence.**

In `finishConversationStream(id)`, synchronously capture whether `get().activeConversationId !== id`, remove the processing flag and draft, and optimistically set `is_unread: true` in the local conversation list only when the target is inactive. Then call the existing `updateConversation(id, { is_unread: true })` and merge the server response. If the target becomes active while that request is in flight, issue the existing `{ is_unread: false }` update from the selection path so selecting the conversation always clears the marker.

The action must catch and log update failures without leaving the spinner or draft behind. If the target was active at completion, do not call the unread API.

- [ ] **Step 5: Clear transient state when deleting a conversation.**

Extend `removeConversation` so successful deletion removes `processingConversationIds[id]` and `streamingDrafts[id]` in the same state update. Leave in-flight network callbacks harmless: target-aware actions may update a missing map entry, but they must not recreate a visible message for a deleted active conversation.

- [ ] **Step 6: Run the TypeScript compiler before wiring the page.**

Run from `NoteFlow_frontend/`:

```bash
pnpm exec tsc --noEmit
```

Expected: the store compiles with no new type errors. This is the first executable checkpoint for the new state interfaces.

### Task 2: Wire the page stream lifecycle and render status icons

**Files:**
- Modify: `/Users/Zhuanz/Documents/prank/BiliNote/NoteFlow_frontend/src/pages/KnowledgeBasePage/index.tsx`

**Interfaces:**
- Consumes the Task 1 store actions keyed by the local `conversationId` captured before starting `askKbStream`.
- Produces a history row whose status slot renders `LoaderCircle` while `processingConversationIds[c.id]` is true, otherwise the existing unread dot when `c.is_unread` is true.

- [ ] **Step 1: Select the new store state/actions and import the spinner icon.**

Add `LoaderCircle` to the `lucide-react` import. Select `processingConversationIds`, `startConversationStream`, `appendConversationMessage`, `appendConversationReasoning`, `setConversationSources`, and `finishConversationStream` from `useKnowledgeBaseStore`.

- [ ] **Step 2: Start the target stream before invoking SSE.**

After the conversation ID has been created/resolved and before `askKbStream(...)`, call:

```ts
startConversationStream(conversationId)
```

Keep the existing local `addMessage` calls so the active conversation immediately shows the user question and assistant placeholder. The target ID must be captured in a local constant and used by every callback; never read `activeConversationId` inside a stream callback.

- [ ] **Step 3: Route all callbacks to target-aware actions and finish in both success/error paths.**

Replace the existing unscoped callback calls with:

```ts
onSources: sources => setConversationSources(conversationId, sources),
onReasoning: text => appendConversationReasoning(conversationId, text),
onDelta: text => appendConversationMessage(conversationId, text),
onError: msg => {
  appendConversationMessage(conversationId, msg || '知识库问答失败')
  toast.error(msg || '知识库问答失败')
},
```

After `await askKbStream(...)`, call `await finishConversationStream(conversationId)` before refreshing the conversation list. In the `catch` block append `\n\n（请求中断）` through `appendConversationMessage(conversationId, ...)`, show the existing toast, and call `await finishConversationStream(conversationId)` there as well. Use a `finally` guard or a single terminal promise so `finishConversationStream` executes exactly once even if `askKbStream` throws after dispatching an error event.

Keep `setLoading(false)` in the final `finally` so the global sender lock is unchanged.

- [ ] **Step 4: Render the fixed-width status slot with spinner precedence.**

In the history row, replace the current direct unread-dot rendering with:

```tsx
const isProcessing = !!processingConversationIds[c.id]

<span className="ml-auto flex h-3.5 w-3.5 shrink-0 items-center justify-center">
  {isProcessing ? (
    <LoaderCircle
      className="h-3.5 w-3.5 animate-spin text-neutral-400"
      aria-label="执行中"
    />
  ) : c.is_unread ? (
    <span className="h-1.5 w-1.5 rounded-full bg-red-500" aria-label="未读" />
  ) : null}
</span>
```

Keep `font-semibold` tied to `c.is_unread`; active styling, pin icon, right-click menu, and title marquee remain unchanged.

- [ ] **Step 5: Check the page type contract.**

Run from `NoteFlow_frontend/`:

```bash
pnpm exec tsc --noEmit
```

Expected: no errors related to callback signatures, optional conversation IDs, or JSX icon props.

### Task 3: Verify behavior and finish the change

**Files:**
- Modify only if verification exposes a defect: `/Users/Zhuanz/Documents/prank/BiliNote/NoteFlow_frontend/src/store/knowledgeBaseStore/index.ts`, `/Users/Zhuanz/Documents/prank/BiliNote/NoteFlow_frontend/src/pages/KnowledgeBasePage/index.tsx`

- [ ] **Step 1: Run lint and production build.**

From `NoteFlow_frontend/` run:

```bash
pnpm lint
pnpm build
```

Expected: ESLint exits 0 and Vite produces the production bundle without TypeScript/build errors.

- [ ] **Step 2: Perform a static scenario review against the approved acceptance cases.**

Inspect the final code and verify each case:

```text
A active + ask -> processing[A] true -> spinner[A] -> finish while active -> no is_unread.
A ask + switch to B -> processing[A] true -> spinner[A] -> finish while inactive -> is_unread[A] true/red dot.
Switch back to A -> selectConversation clears is_unread and loads persisted answer.
Switch away and back while processing -> draft[A] overlays fetched messages; no second ask.
Multiple switches -> callbacks use captured A ID; B messages are never modified.
Refresh -> transient maps reset; persisted messages/unread state load normally.
Delete while processing -> transient maps are removed and no stale row remains.
```

- [ ] **Step 3: Review the diff for scope and unrelated changes.**

Run:

```bash
git diff -- NoteFlow_frontend/src/store/knowledgeBaseStore/index.ts NoteFlow_frontend/src/pages/KnowledgeBasePage/index.tsx
git status --short
```

Confirm only the two feature files contain implementation changes and all pre-existing worktree changes remain untouched.

- [ ] **Step 4: Commit the implementation.**

```bash
git add NoteFlow_frontend/src/store/knowledgeBaseStore/index.ts NoteFlow_frontend/src/pages/KnowledgeBasePage/index.tsx
git commit -m "feat: show knowledge base conversation progress"
```

