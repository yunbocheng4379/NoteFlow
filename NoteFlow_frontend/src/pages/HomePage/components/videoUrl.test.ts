import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { getOriginalVideoUrl } from './videoUrl.ts'

test('uses the task URL before downloader metadata', () => {
  assert.equal(
    getOriginalVideoUrl('https://www.douyin.com/video/123', {
      webpage_url: 'https://www.douyin.com/video/456',
    }),
    'https://www.douyin.com/video/123',
  )
})

test('falls back to the downloader webpage URL for history metadata', () => {
  assert.equal(
    getOriginalVideoUrl(undefined, { webpage_url: 'https://www.kuaishou.com/short-video/123' }),
    'https://www.kuaishou.com/short-video/123',
  )
})

test('ignores non-web URLs', () => {
  assert.equal(getOriginalVideoUrl('cloud://baidu_pan/123', { source_url: 'local-file.mp4' }), '')
})

test('rebuilds legacy Douyin and Kuaishou URLs from task metadata', () => {
  const resolveLegacyUrl = getOriginalVideoUrl as unknown as (
    videoUrl: string | undefined,
    rawInfo: Record<string, unknown> | null,
    platform: string,
    videoId: string,
  ) => string

  assert.equal(
    resolveLegacyUrl('', null, 'douyin', '7666716416389047507'),
    'https://www.douyin.com/video/7666716416389047507',
  )
  assert.equal(
    resolveLegacyUrl('', null, 'kuaishou', '3xsuu8kd954r9ki'),
    'https://www.kuaishou.com/short-video/3xsuu8kd954r9ki',
  )
})
