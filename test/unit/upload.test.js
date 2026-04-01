import { unit as test } from '../testpup.js'
import {
  UPLOAD_EXT_MAP,
  getUploadExt,
  parseUploadContentType,
  sanitizeUploadKey
} from '../../worker/auth.js'
import { emojiKeyToName, emojiKeyToUrl } from '../../worker/index.js'

// — parseUploadContentType —

test('parseUploadContentType: strips charset param', t => {
  t.is(parseUploadContentType('audio/webm; codecs=opus'), 'audio/webm')
})

test('parseUploadContentType: passes through clean type', t => {
  t.is(parseUploadContentType('image/png'), 'image/png')
})

test('parseUploadContentType: handles null', t => {
  t.is(parseUploadContentType(null), '')
})

test('parseUploadContentType: handles undefined', t => {
  t.is(parseUploadContentType(undefined), '')
})

test('parseUploadContentType: handles empty string', t => {
  t.is(parseUploadContentType(''), '')
})

// — getUploadExt —

test('getUploadExt: image/jpeg → jpg', t => {
  t.is(getUploadExt('image/jpeg'), 'jpg')
})

test('getUploadExt: image/png → png', t => {
  t.is(getUploadExt('image/png'), 'png')
})

test('getUploadExt: image/gif → gif', t => {
  t.is(getUploadExt('image/gif'), 'gif')
})

test('getUploadExt: image/webp → webp', t => {
  t.is(getUploadExt('image/webp'), 'webp')
})

test('getUploadExt: image/svg+xml → svg', t => {
  t.is(getUploadExt('image/svg+xml'), 'svg')
})

test('getUploadExt: audio/webm → webm', t => {
  t.is(getUploadExt('audio/webm'), 'webm')
})

test('getUploadExt: audio/ogg → ogg', t => {
  t.is(getUploadExt('audio/ogg'), 'ogg')
})

test('getUploadExt: audio/mp4 → m4a', t => {
  t.is(getUploadExt('audio/mp4'), 'm4a')
})

test('getUploadExt: audio/mpeg → mp3', t => {
  t.is(getUploadExt('audio/mpeg'), 'mp3')
})

test('getUploadExt: audio/wav → wav', t => {
  t.is(getUploadExt('audio/wav'), 'wav')
})

test('getUploadExt: unknown type returns null', t => {
  t.is(getUploadExt('video/mp4'), null)
})

test('getUploadExt: application/json returns null', t => {
  t.is(getUploadExt('application/json'), null)
})

test('getUploadExt: empty string returns null', t => {
  t.is(getUploadExt(''), null)
})

test('getUploadExt: undefined returns null', t => {
  t.is(getUploadExt(undefined), null)
})

test('UPLOAD_EXT_MAP: has exactly 10 entries', t => {
  t.is(Object.keys(UPLOAD_EXT_MAP).length, 10)
})

test('UPLOAD_EXT_MAP: all values are non-empty strings', t => {
  for (const [, ext] of Object.entries(UPLOAD_EXT_MAP)) {
    t.ok(typeof ext === 'string' && ext.length > 0)
  }
})

// — sanitizeUploadKey —

test('sanitizeUploadKey: valid path passes through', t => {
  t.is(sanitizeUploadKey('images/abc123.jpg'), 'images/abc123.jpg')
})

test('sanitizeUploadKey: valid audio path passes through', t => {
  t.is(sanitizeUploadKey('audio/abc123.webm'), 'audio/abc123.webm')
})

test('sanitizeUploadKey: path traversal returns null', t => {
  t.is(sanitizeUploadKey('../../etc/passwd'), null)
})

test('sanitizeUploadKey: traversal mid-path returns null', t => {
  t.is(sanitizeUploadKey('images/../../../etc/passwd'), null)
})

test('sanitizeUploadKey: null byte returns null', t => {
  t.is(sanitizeUploadKey('images/foo\x00bar.jpg'), null)
})

test('sanitizeUploadKey: leading slash returns null', t => {
  t.is(sanitizeUploadKey('/images/foo.jpg'), null)
})

test('sanitizeUploadKey: empty string returns null', t => {
  t.is(sanitizeUploadKey(''), null)
})

test('sanitizeUploadKey: UUID filename is valid', t => {
  t.is(sanitizeUploadKey('images/550e8400-e29b-41d4-a716-446655440000.jpg'), 'images/550e8400-e29b-41d4-a716-446655440000.jpg')
})

// — emojiKeyToName —

test('emojiKeyToName: strips extension', t => {
  t.is(emojiKeyToName('party.gif'), 'party')
})

test('emojiKeyToName: strips png extension', t => {
  t.is(emojiKeyToName('fire.png'), 'fire')
})

test('emojiKeyToName: strips svg extension', t => {
  t.is(emojiKeyToName('vibes.svg'), 'vibes')
})

test('emojiKeyToName: handles hyphenated names', t => {
  t.is(emojiKeyToName('eye-roll.gif'), 'eye-roll')
})

test('emojiKeyToName: handles underscored names', t => {
  t.is(emojiKeyToName('thumbs_up.gif'), 'thumbs_up')
})

test('emojiKeyToName: no extension returns as-is', t => {
  t.is(emojiKeyToName('noext'), 'noext')
})

// — emojiKeyToUrl —

test('emojiKeyToUrl: produces correct path', t => {
  t.is(emojiKeyToUrl('party.gif'), '/emoji/party.gif')
})

test('emojiKeyToUrl: preserves filename exactly', t => {
  t.is(emojiKeyToUrl('MY-EMOJI.png'), '/emoji/MY-EMOJI.png')
})
