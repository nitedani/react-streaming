export { createBuffer }
export type { InjectToStream }
export type { StreamOperations }

import { assert, assertUsage, createDebugger } from '../utils'

const debug = createDebugger('react-streaming:buffer')

type InjectToStreamOptions = { flush?: boolean; expectStreamEnd?: boolean }
type InjectToStream = (chunk: unknown, options?: InjectToStreamOptions) => boolean
type StreamOperations = {
  operations: null | { writeChunk: (chunk: unknown) => void; flush: null | (() => void) }
}

function createBuffer(streamOperations: StreamOperations): {
  injectToStream: InjectToStream
  onBeforeWrite: (chunk: unknown) => void
  onBeforeEnd: () => void
  hasStreamEnded: () => boolean
} {
  const buffer: { chunk: unknown; flush: undefined | boolean }[] = []
  let state: 'UNSTARTED' | 'STREAMING' | 'ENDED' = 'UNSTARTED'
  let writePermission: null | boolean = null // Set to `null` because React fails to hydrate if something is injected before the first react write

  return { injectToStream, onBeforeWrite, onBeforeEnd, hasStreamEnded }

  function injectToStream(chunk: unknown, options?: InjectToStreamOptions): boolean {
    if (debug.isEnabled) {
      debug('injectToStream()', getChunkAsString(chunk))
    }
    if (hasStreamEnded()) {
      if (!options?.expectStreamEnd) {
        assertUsage(state, `Cannot inject following chunk after stream has ended:\n${getChunkAsString(chunk)}`)
      }
      return false
    }
    buffer.push({ chunk, flush: options?.flush })
    flushBuffer()
    return true
  }

  function flushBuffer() {
    if (!writePermission) {
      return
    }
    if (buffer.length === 0) {
      return
    }
    if (state !== 'STREAMING') {
      assert(state === 'UNSTARTED')
      return
    }
    let flushStream = false
    buffer.forEach((bufferEntry) => {
      assert(streamOperations.operations)
      const { writeChunk } = streamOperations.operations
      writeChunk(bufferEntry.chunk)
      if (bufferEntry.flush) {
        flushStream = true
      }
    })
    buffer.length = 0
    assert(streamOperations.operations)
    if (flushStream && streamOperations.operations.flush !== null) {
      streamOperations.operations.flush()
      debug('stream flushed')
    }
  }

  function onBeforeWrite(chunk: unknown) {
    state === 'UNSTARTED' && debug('>>> START')
    if (debug.isEnabled) {
      debug(`react write${!writePermission ? '' : ' (allowed)'}`, getChunkAsString(chunk))
    }
    state = 'STREAMING'
    if (writePermission) {
      flushBuffer()
    }
    if (writePermission == true || writePermission === null) {
      writePermission = false
      debug('writePermission =', writePermission)
      setTimeout(() => {
        debug('>>> setTimeout()')
        writePermission = true
        debug('writePermission =', writePermission)
        flushBuffer()
      })
    }
  }

  function onBeforeEnd() {
    writePermission = true
    debug('writePermission =', writePermission)
    flushBuffer()
    assert(buffer.length === 0)
    state = 'ENDED'
    debug('>>> END')
  }

  function hasStreamEnded() {
    return state === 'ENDED'
  }
}

function getChunkAsString(chunk: unknown): string {
  try {
    return new TextDecoder().decode(chunk as any)
  } catch (err) {
    return String(chunk)
  }
}
