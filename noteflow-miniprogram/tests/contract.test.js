const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeAuthResult,
  saveSessionPayload,
  buildGeneratePayload,
  unwrapResponse,
  mapTaskStatus,
  normalizeTask,
  buildChatPayload,
} = require('../utils/contracts');
const { parseUrl } = require('../utils/platform-detector');
const { parse: parseMarkdown } = require('../utils/markdown-parser');

test('normalizes backend auth response', () => {
  assert.deepEqual(normalizeAuthResult({ token: 'jwt', user: { id: 1 } }), {
    token: 'jwt',
    refreshToken: '',
    user: { id: 1 },
  });
  assert.equal(normalizeAuthResult({ access_token: 'legacy' }).token, 'legacy');
});

test('creates stable session payload', () => {
  assert.deepEqual(saveSessionPayload({ token: 'jwt', user: { username: 'Z' } }), {
    accessToken: 'jwt',
    refreshToken: '',
    user: { username: 'Z' },
  });
});

test('builds VideoRequest field names', () => {
  assert.deepEqual(buildGeneratePayload({
    url: 'https://www.bilibili.com/video/BV1xx',
    platform: 'bilibili',
    provider: { id: 'p1' },
    model: { name: 'model-a' },
    style: { value: 'outline' },
  }), {
    video_url: 'https://www.bilibili.com/video/BV1xx',
    platform: 'bilibili',
    quality: 'best',
    screenshot: false,
    link: false,
    model_name: 'model-a',
    provider_id: 'p1',
    format: [],
    style: 'outline',
    video_understanding: false,
    video_interval: 0,
    grid_size: [],
  });
});

test('builds a complete home generation form', () => {
  const payload = buildGeneratePayload({
    url: 'https://www.bilibili.com/video/BV1xx',
    platform: 'bilibili',
    provider: { id: 'p1' },
    model: { name: 'model-a' },
    style: { value: 'outline' },
  });
  assert.equal(payload.video_url, 'https://www.bilibili.com/video/BV1xx');
  assert.equal(payload.platform, 'bilibili');
  assert.equal(payload.model_name, 'model-a');
  assert.equal(payload.provider_id, 'p1');
  assert.equal(payload.style, 'outline');
});

test('unwraps success and throws business errors', () => {
  assert.deepEqual(unwrapResponse({ code: 200, data: { ok: true } }), { ok: true });
  assert.throws(() => unwrapResponse({ code: 400, msg: '参数错误' }), {
    code: 400,
    message: '参数错误',
  });
});

test('maps task states', () => {
  assert.deepEqual(mapTaskStatus('SUCCESS'), {
    key: 'success',
    label: '已完成',
    terminal: true,
    progress: 100,
  });
  assert.equal(mapTaskStatus('FAILED').terminal, true);
  assert.equal(mapTaskStatus('PENDING').progress, 12);
});

test('normalizes task list records', () => {
  assert.deepEqual(normalizeTask({ task_id: 't1', status: 'SUCCESS' }), {
    task_id: 't1',
    status: 'success',
    id: 't1',
    title: '未命名笔记',
    statusLabel: '已完成',
    terminal: true,
    progress: 100,
  });
});

test('builds the non-streaming chat request', () => {
  assert.deepEqual(buildChatPayload({
    taskId: 't1',
    question: '总结一下',
    history: [{ role: 'user', content: '你好' }],
    providerId: 'p1',
    modelName: 'model-a',
  }), {
    task_id: 't1',
    question: '总结一下',
    history: [{ role: 'user', content: '你好' }],
    provider_id: 'p1',
    model_name: 'model-a',
  });
});

test('preserves chat history when building a retryable request', () => {
  const payload = buildChatPayload({ taskId: 't2', question: '再解释一次', history: [{ role: 'assistant', content: '上一条' }], providerId: 'p2', modelName: 'model-b' });
  assert.equal(payload.task_id, 't2');
  assert.equal(payload.history[0].role, 'assistant');
  assert.equal(payload.model_name, 'model-b');
});

test('recognizes supported platforms', () => {
  assert.equal(parseUrl('https://www.bilibili.com/video/BV1xx'), 'bilibili');
  assert.equal(parseUrl('https://youtu.be/abc'), 'youtube');
  assert.equal(parseUrl('https://example.com/video'), null);
});

test('markdown parser emits the node shapes used by the reader', () => {
  const nodes = parseMarkdown('# 标题\n\n一段文字\n\n- 要点\n\n```js\nconst a = 1;\n```', { proxyImages: false });
  assert.equal(nodes.find((node) => node.type === 'h1').content[0].content, '标题');
  assert.equal(nodes.find((node) => node.type === 'p').content[0].content, '一段文字');
  assert.deepEqual(nodes.find((node) => node.type === 'ul').items[0][0].content, '要点');
  assert.equal(nodes.find((node) => node.type === 'code').content, 'const a = 1;');
});
