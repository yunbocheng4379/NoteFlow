const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeAuthResult,
  saveSessionPayload,
  buildGeneratePayload,
  unwrapResponse,
  mapTaskStatus,
} = require('../utils/contracts');
const { parseUrl } = require('../utils/platform-detector');

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

test('recognizes supported platforms', () => {
  assert.equal(parseUrl('https://www.bilibili.com/video/BV1xx'), 'bilibili');
  assert.equal(parseUrl('https://youtu.be/abc'), 'youtube');
  assert.equal(parseUrl('https://example.com/video'), null);
});
