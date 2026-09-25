/**
 * Music module — audio metadata parser tests.
 *
 * Each format is exercised against a synthetic container built by
 * `test/helpers/audioFixtures.ts`, so the assertions pin the exact field
 * mapping (including the awkward ones: ID3v1 genre codes, MP4 `trkn` layout,
 * Opus granules being at 48 kHz regardless of the input rate).
 */
import { describe, it, expect } from 'vitest'
import { parseFlac } from '../../server/utils/tagFlac'
import { parseMp3 } from '../../server/utils/tagId3'
import { parseMp4 } from '../../server/utils/tagMp4'
import { parseOgg } from '../../server/utils/tagOgg'
import { parseBase64Picture, parseTrackNumber, parseYear, parseVorbisComment } from '../../server/utils/vorbis'
import {
  detectAudioFormat,
  extractAudioMetadata,
  isSupportedAudio,
  mimeForFormat,
  audioMimeType,
  parseAudioFilename
} from '../../server/utils/audioMeta'
import {
  buildFlac,
  buildM4a,
  buildMp3,
  buildOgg,
  MP3_CBR_AUDIO_BYTES
} from '../helpers/audioFixtures'

describe('format detection', () => {
  it('trusts magic bytes over a misleading extension', () => {
    expect(detectAudioFormat('song.mp3', buildFlac())).toBe('flac')
    expect(detectAudioFormat('mystery.dat', buildMp3())).toBe('mp3')
    expect(detectAudioFormat('x.bin', buildM4a())).toBe('m4a')
    expect(detectAudioFormat('y.bin', buildOgg())).toBe('ogg')
  })

  it('falls back to the extension when the bytes are not conclusive', () => {
    expect(detectAudioFormat('song.flac', Buffer.from('nonsense'))).toBe('flac')
    expect(detectAudioFormat('song.opus', Buffer.from('nonsense'))).toBe('ogg')
    expect(detectAudioFormat('song.aac', Buffer.from('nonsense'))).toBe('m4a')
    expect(detectAudioFormat('song.txt', Buffer.from('nonsense'))).toBeNull()
  })

  it('accepts the extensions we support and reports their MIME types', () => {
    for (const name of ['a.mp3', 'a.flac', 'a.m4a', 'a.ogg', 'a.opus', 'a.oga']) {
      expect(isSupportedAudio(name)).toBe(true)
    }
    expect(isSupportedAudio('a.wav')).toBe(false)
    expect(isSupportedAudio('a.pdf')).toBe(false)
    expect(audioMimeType('a.flac')).toBe('audio/flac')
    expect(audioMimeType('a.opus')).toBe('audio/ogg')
    expect(audioMimeType('a.wav')).toBeNull()
    expect(mimeForFormat('m4a')).toBe('audio/mp4')
    expect(mimeForFormat('nope')).toBe('application/octet-stream')
  })
})

describe('parseAudioFilename', () => {
  it('splits Artist - Title', () => {
    expect(parseAudioFilename('Radiohead - Creep.mp3')).toEqual({ title: 'Creep', artist: 'Radiohead' })
  })

  it('drops a leading track number before splitting', () => {
    expect(parseAudioFilename('05 - Radiohead - Creep.flac')).toEqual({ title: 'Creep', artist: 'Radiohead' })
    expect(parseAudioFilename('07 Song.mp3')).toEqual({ title: '07 Song' })
    expect(parseAudioFilename('07. Song.mp3')).toEqual({ title: 'Song' })
  })

  it('falls back to the bare name', () => {
    expect(parseAudioFilename('untitled.mp3')).toEqual({ title: 'untitled' })
    expect(parseAudioFilename('.mp3')).toEqual({ title: 'Unknown track' })
  })
})

describe('MP3 / ID3', () => {
  it('reads ID3v2 text frames, including UTF-8 and multi-value fields', () => {
    const info = parseMp3(buildMp3())
    expect(info.fields.title).toBe('夜航西飞')
    expect(info.fields.artist).toBe('Test Artist')
    expect(info.fields.album).toBe('Test Album')
    expect(info.fields.albumArtist).toBe('Test Album Artist')
    expect(info.fields.year).toBe(1998)
    expect(info.fields.trackNo).toBe(3)
    expect(info.fields.discNo).toBe(1)
    expect(info.fields.lyrics).toBe('First line\nSecond line')
  })

  it('resolves a numeric TCON genre reference', () => {
    // `(17)` maps to the 18th ID3v1 genre.
    expect(parseMp3(buildMp3()).fields.genre).toBe('Rock')
  })

  it('reads an embedded APIC picture', () => {
    const info = parseMp3(buildMp3({ picture: Buffer.from([1, 2, 3, 4]) }))
    expect(info.picture?.mime).toBe('image/png')
    expect(info.picture?.data.equals(Buffer.from([1, 2, 3, 4]))).toBe(true)
  })

  it('estimates the runtime of a CBR file from the audio payload', () => {
    const info = parseMp3(buildMp3())
    // 4 frames of 417 bytes at 128 kbps.
    expect(info.duration).toBeCloseTo((MP3_CBR_AUDIO_BYTES * 8) / 128000, 4)
    expect(info.bitrate).toBe(128)
    expect(info.sampleRate).toBe(44100)
    expect(info.channels).toBe(2)
  })

  it('prefers the encoder frame count when a Xing header is present', () => {
    const info = parseMp3(buildMp3({ xingFrames: 100 }))
    // 100 frames of 1152 samples at 44.1 kHz.
    expect(info.duration).toBeCloseTo((100 * 1152) / 44100, 4)
  })
})

describe('FLAC', () => {
  it('reads STREAMINFO, Vorbis comments and the picture block', () => {
    const info = parseFlac(buildFlac({ picture: Buffer.from([9, 9]) }))
    expect(info).not.toBeNull()
    expect(info!.duration).toBe(2)
    expect(info!.sampleRate).toBe(44100)
    expect(info!.channels).toBe(2)
    expect(info!.bitsPerSample).toBe(16)
    expect(info!.fields.title).toBe('Flac Title')
    expect(info!.fields.artist).toBe('Flac Artist')
    expect(info!.fields.albumArtist).toBe('Flac Album Artist')
    expect(info!.fields.genre).toBe('Jazz')
    expect(info!.fields.year).toBe(2001)
    expect(info!.fields.trackNo).toBe(7)
    expect(info!.fields.discNo).toBe(2)
    expect(info!.fields.lyrics).toBe('flac lyrics')
    expect(info!.picture?.data.equals(Buffer.from([9, 9]))).toBe(true)
  })

  it('joins repeated ARTIST fields', () => {
    const info = parseFlac(buildFlac({ fields: [['TITLE', 'T'], ['ARTIST', 'A'], ['ARTIST', 'B']] }))
    expect(info!.fields.artist).toBe('A, B')
  })

  it('returns zero duration when total samples were never written', () => {
    const info = parseFlac(buildFlac({ totalSamples: 0 }))
    expect(info!.duration).toBe(0)
  })

  it('rejects a buffer that is not FLAC', () => {
    expect(parseFlac(Buffer.from('ID3xxxxx'))).toBeNull()
  })
})

describe('M4A / MP4', () => {
  it('walks mvhd, ilst and data boxes', () => {
    const info = parseMp4(buildM4a())
    expect(info).not.toBeNull()
    expect(info!.duration).toBe(180)
    expect(info!.fields.title).toBe('M4A Title')
    expect(info!.fields.artist).toBe('M4A Artist')
    expect(info!.fields.albumArtist).toBe('M4A Album Artist')
    expect(info!.fields.album).toBe('M4A Album')
    expect(info!.fields.genre).toBe('Electronic')
    expect(info!.fields.year).toBe(2019)
    expect(info!.fields.lyrics).toBe('m4a lyrics')
    expect(info!.fields.compilation).toBe(true)
  })

  it('decodes the binary trkn / disk payloads', () => {
    const info = parseMp4(buildM4a())
    expect(info!.fields.trackNo).toBe(5)
    expect(info!.fields.discNo).toBe(2)
  })

  it('reads cover art and maps the well-known type to a MIME type', () => {
    const info = parseMp4(buildM4a())
    expect(info!.picture?.mime).toBe('image/png')
    expect(info!.picture?.data.length).toBe(4)
  })

  it('rejects a buffer without a moov box', () => {
    expect(parseMp4(Buffer.from('not an mp4 at all'))).toBeNull()
  })
})

describe('Ogg', () => {
  it('reads the Vorbis identification and comment headers, plus the granule', () => {
    const info = parseOgg(buildOgg())
    expect(info).not.toBeNull()
    expect(info!.codec).toBe('vorbis')
    expect(info!.duration).toBe(2)
    expect(info!.sampleRate).toBe(44100)
    expect(info!.channels).toBe(2)
    expect(info!.fields.title).toBe('Ogg Title')
    expect(info!.fields.artist).toBe('Ogg Artist')
    expect(info!.fields.year).toBe(2011)
    expect(info!.fields.trackNo).toBe(9)
  })

  it('counts Opus granules at 48 kHz, not at the input rate', () => {
    // Input rate 44100 but a granule of 96000 → 2 seconds.
    const info = parseOgg(buildOgg({ codec: 'opus', sampleRate: 44100, granule: 96000 }))
    expect(info!.codec).toBe('opus')
    expect(info!.duration).toBe(2)
  })

  it('rejects a buffer without an Ogg capture pattern', () => {
    expect(parseOgg(Buffer.from('fLaC something'))).toBeNull()
  })
})

describe('vorbis helpers', () => {
  it('parses comments and tolerates a truncated buffer', () => {
    const { tags } = parseVorbisComment(
      (() => {
        const vendor = Buffer.from('v', 'utf8')
        const vendorLength = Buffer.alloc(4)
        vendorLength.writeUInt32LE(vendor.length)
        const count = Buffer.alloc(4)
        count.writeUInt32LE(1)
        const entry = Buffer.from('TITLE=x', 'utf8')
        const length = Buffer.alloc(4)
        length.writeUInt32LE(entry.length)
        return Buffer.concat([vendorLength, vendor, count, length, entry])
      })(),
      0
    )
    expect(tags.get('TITLE')).toEqual(['x'])
    expect(parseVorbisComment(Buffer.from([1, 2]), 0).tags.size).toBe(0)
  })

  it('rejects malformed base64 pictures', () => {
    expect(parseBase64Picture(undefined)).toBeNull()
    expect(parseBase64Picture('not base64 at all!!')).toBeNull()
  })

  it('parses track numbers and years leniently', () => {
    expect(parseTrackNumber('3/12')).toBe(3)
    expect(parseTrackNumber('A1')).toBe(1)
    expect(parseTrackNumber(undefined)).toBeUndefined()
    expect(parseYear('1998-05-01')).toBe(1998)
    expect(parseYear('05/1998')).toBe(1998)
    expect(parseYear('nope')).toBeUndefined()
  })
})

describe('extractAudioMetadata', () => {
  it('normalises every container into one shape', () => {
    const mp3 = extractAudioMetadata(buildMp3(), 'x.mp3')
    expect(mp3.format).toBe('mp3')
    expect(mp3.duration).toBeGreaterThan(0)

    const flac = extractAudioMetadata(buildFlac(), 'x.flac')
    expect(flac.format).toBe('flac')
    expect(flac.duration).toBe(2)
    expect(flac.bitrate).toBeGreaterThan(0) // averaged from size / duration

    const m4a = extractAudioMetadata(buildM4a(), 'x.m4a')
    expect(m4a.format).toBe('m4a')
    expect(m4a.duration).toBe(180)

    const ogg = extractAudioMetadata(buildOgg(), 'x.ogg')
    expect(ogg.format).toBe('ogg')
    expect(ogg.duration).toBe(2)
  })

  it('falls back to the filename when the tags are empty', () => {
    const meta = extractAudioMetadata(buildMp3(), 'Radiohead - Creep.mp3')
    expect(meta.title).toBe('夜航西飞') // the tag wins when it exists
    const untagged = extractAudioMetadata(Buffer.from('garbage'), 'Radiohead - Creep.mp3')
    expect(untagged.title).toBe('Creep')
    expect(untagged.artist).toBe('Radiohead')
  })

  it('never throws on a broken tag block', () => {
    const broken = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(64, 0xFF), buildMp3()])
    const meta = extractAudioMetadata(broken, 'broken.mp3')
    expect(meta.format).toBe('mp3')
    expect(typeof meta.title).toBe('string')
  })
})
