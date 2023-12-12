import { Continue, FailureReason, ReturnValue } from "../HeadersParser.js"

const constMaxPairs = 100
const constMaxSize = 16 * 1024

const enum State {
  key,
  whitespace,
  value,
}

const constContinue: Continue = { _tag: "Continue" }

const constNameChars = [
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 1, 1, 1, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1, 1, 1, 1,
  1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 0, 1,
]

const constValueChars = [
  0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1,
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
]

const ASCII_TAB = 9; // ASCII '\t'
const ASCII_LF = 10; // ASCII '\n'
const ASCII_CR = 13; // ASCII '\r'
const ASCII_SPACE = 32; // ASCII ' '
const ASCII_COLON = 58; // ASCII ':'


export function make() {
  const decoder = new TextDecoder()
  const state = {
    state: State.key,
    headers: Object.create(null) as Record<string, string>,
    key: Uint8Array.of(),
    value: Uint8Array.of(),
    crlf: 0,
    previousChunk: undefined as undefined | Uint8Array,
    pairs: 0,
    size: 0,
  }

  function reset(value: ReturnValue): ReturnValue {
    state.state = State.key
    state.headers = Object.create(null)
    state.key = Uint8Array.of()
    state.value = Uint8Array.of()
    state.crlf = 0
    state.previousChunk = undefined
    state.pairs = 0
    state.size = 0
    return value
  }

  function concatUint8Array(a: Uint8Array, b: Uint8Array): Uint8Array {
    const newUint8Array = new Uint8Array(a.length + b.length)
    newUint8Array.set(a)
    newUint8Array.set(b, a.length)
    return newUint8Array
  }

  function error(reason: FailureReason) {
    return reset({ _tag: "Failure", reason, headers: state.headers })
  }

  return function write(chunk: Uint8Array, start: number): ReturnValue {
    let endOffset = 0
    let previousCursor: number | undefined
    if (state.previousChunk !== undefined) {
      endOffset = state.previousChunk.length
      previousCursor = endOffset

      const newChunk = new Uint8Array(chunk.length + endOffset)
      newChunk.set(state.previousChunk)
      newChunk.set(chunk, endOffset)
      state.previousChunk = undefined
      chunk = newChunk
    }
    const end = chunk.length

    outer: while (start < end) {
      if (state.state === State.key) {
        let i = start
        for (; i < end; i++) {
          if (state.size++ > constMaxSize) {
            return error("HeaderTooLarge")
          }

          if (chunk[i] === ASCII_COLON) {
            state.key = concatUint8Array(state.key, chunk.slice(start, i))
            if (state.key.length === 0) {
              return error("InvalidHeaderName")
            }

            start = i + 1;

            switch (end - start) {
              case 0:
                state.state = State.whitespace
                continue outer
              case 1: {
                const lookahead = chunk[i++];
                if (lookahead !== ASCII_SPACE && lookahead !== ASCII_TAB) {
                  state.state = State.value
                  start = i
                }
                continue outer
              }
              default: {
                // we can do at least 2 characters look ahead for possibly skip whitespace state
                let lookahead = chunk[i++];
                if (lookahead !== ASCII_SPACE && lookahead !== ASCII_TAB) {
                  state.state = State.value
                  start = i
                  continue outer
                }
                lookahead = chunk[i++];
                if (lookahead !== ASCII_SPACE && lookahead !== ASCII_TAB) {
                  state.state = State.value
                  start = i
                  continue outer
                }
                state.state = State.whitespace
                continue outer
              }

            }
          } else if (constNameChars[chunk[i]] !== 1) {
            return error("InvalidHeaderName")
          }
        }
        if (i === end) {
          state.key = concatUint8Array(state.key, chunk.slice(start, end))
          return constContinue
        }
      }

      if (state.state === State.whitespace) {
        for (; start < end; start++) {
          if (state.size++ > constMaxSize) {
            return error("HeaderTooLarge")
          }

          if (chunk[start] !== ASCII_SPACE && chunk[start] !== ASCII_TAB) {
            state.state = State.value
            break
          }
        }
        if (start === end) {
          return constContinue
        }
      }

      if (state.state === State.value) {
        let i = start
        if (previousCursor !== undefined) {
          i = previousCursor
          previousCursor = undefined
        }
        for (; i < end; i++) {
          if (state.size++ > constMaxSize) {
            return error("HeaderTooLarge")
          }

          if (chunk[i] === ASCII_CR || state.crlf > 0) {
            let byte = chunk[i]

            if (byte === ASCII_CR && state.crlf === 0) {
              state.crlf = 1
              i++
              state.size++
              byte = chunk[i]
            }
            if (byte === ASCII_LF && state.crlf === 1) {
              state.crlf = 2
              i++
              state.size++
              byte = chunk[i]
            }
            if (byte === ASCII_CR && state.crlf === 2) {
              state.crlf = 3
              i++
              state.size++
              byte = chunk[i]
            }
            if (byte === ASCII_LF && state.crlf === 3) {
              state.crlf = 4
              i++
              state.size++
            }

            if (state.crlf < 4 && i >= end) {
              state.previousChunk = chunk.subarray(start)
              return constContinue
            } else if (state.crlf >= 2) {
              state.value = concatUint8Array(state.value, chunk.slice(start, i - state.crlf))
              const key = decoder.decode(state.key).toLowerCase()
              const value = decoder.decode(state.value)
              state.headers[key] = value

              start = i
              state.size--

              if (state.crlf !== 4 && state.pairs === constMaxPairs) {
                return error("TooManyHeaders")
              } else if (state.crlf === 3) {
                return error("InvalidHeaderValue")
              } else if (state.crlf === 4) {
                return reset({
                  _tag: "Headers",
                  headers: state.headers,
                  endPosition: start - endOffset,
                })
              }

              state.pairs++
              state.key = Uint8Array.of()
              state.value = Uint8Array.of()
              state.crlf = 0
              state.state = State.key

              continue outer
            }
          } else if (constValueChars[chunk[i]] !== 1) {
            return error("InvalidHeaderValue")
          }
        }

        if (i === end) {
          state.value = concatUint8Array(state.value, chunk.slice(start, end))
          return constContinue
        }
      }
    }

    if (start > end) {
      state.size += end - start
    }

    return constContinue
  }
}
