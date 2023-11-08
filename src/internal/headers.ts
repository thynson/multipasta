const MAX_PAIRS = 100
const MAX_SIZE = 16 * 1024

const enum State {
  key,
  whitespace,
  value,
}

export type FailureReason =
  | "TooManyHeaders"
  | "HeaderTooLarge"
  | "InvalidHeader"

export type ReturnValue =
  | {
      readonly _tag: "Continue"
    }
  | {
      readonly _tag: "Failure"
      readonly reason: FailureReason
      readonly headers: ReadonlyArray<readonly [name: string, value: string]>
    }
  | {
      readonly _tag: "Headers"
      readonly headers: ReadonlyArray<readonly [name: string, value: string]>
      readonly endPosition: number
    }

const constContinue: ReturnValue = { _tag: "Continue" }

const constNameChars = [
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 1, 1, 1, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1, 1, 1, 1,
  1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 0, 1,
]
constNameChars[58] = 1

const constValueChars = [
  0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
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

export function make() {
  const decoder = new TextDecoder()
  const state = {
    state: State.key,
    headers: [] as Array<readonly [name: string, value: string]>,
    key: "",
    value: "",
    crlf: 0,
    pairs: 0,
    size: 0,
  }

  function reset(value: ReturnValue): ReturnValue {
    state.state = State.key
    state.headers = []
    state.key = ""
    state.value = ""
    state.crlf = 0
    state.pairs = 0
    state.size = 0
    return value
  }

  function error(reason: FailureReason) {
    return reset({ _tag: "Failure", reason, headers: state.headers })
  }

  return function write(
    chunk: Uint8Array,
    start = 0,
    end = chunk.length,
  ): ReturnValue {
    outer: while (start < end) {
      if (state.state === State.key) {
        let i = start
        for (; i < end; i++) {
          if (state.size++ > MAX_SIZE) {
            return error("HeaderTooLarge")
          }

          if (constNameChars[chunk[i]] !== 1) {
            return error("InvalidHeader")
          } else if (chunk[i] === 58) {
            state.key += decoder.decode(chunk.slice(start, i)).toLowerCase()

            if (
              chunk[i + 1] === 32 &&
              chunk[i + 2] !== 32 &&
              chunk[i + 2] !== 9
            ) {
              start = i + 2
              state.state = State.value
              state.size++
            } else if (chunk[i + 1] !== 32 && chunk[i + 1] !== 9) {
              start = i + 1
              state.state = State.value
            } else {
              start = i + 1
              state.state = State.whitespace
            }

            break
          }
        }
        if (i === end) {
          state.key += decoder.decode(chunk.slice(start, end)).toLowerCase()
          return constContinue
        }
      }

      if (state.state === State.whitespace) {
        for (; start < end; start++) {
          if (state.size++ > MAX_SIZE) {
            return error("HeaderTooLarge")
          }

          if (chunk[start] !== 32 && chunk[start] !== 9) {
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
        for (; i < end; i++) {
          if (state.size++ > MAX_SIZE) {
            return error("HeaderTooLarge")
          }

          if (constValueChars[chunk[i]] !== 1) {
            return error("InvalidHeader")
          } else if (chunk[i] === 13 || state.crlf > 0) {
            let byte = chunk[i]

            if (byte === 13 && state.crlf === 0) {
              state.crlf = 1
              i++
              state.size++
              byte = chunk[i]
            }
            if (byte === 10 && state.crlf === 1) {
              state.crlf = 2
              i++
              state.size++
              byte = chunk[i]
            }
            if (byte === 13 && state.crlf === 2) {
              state.crlf = 3
              i++
              state.size++
              byte = chunk[i]
            }
            if (byte === 10 && state.crlf === 3) {
              state.crlf = 4
              i++
              state.size++
            }

            if (state.crlf >= 2) {
              state.value += decoder.decode(chunk.slice(start, i - state.crlf))
              state.headers.push([state.key, state.value])

              start = i

              if (state.crlf !== 4 && state.pairs === MAX_PAIRS) {
                return error("TooManyHeaders")
              } else if (state.crlf === 3) {
                return error("InvalidHeader")
              } else if (state.crlf === 4) {
                return reset({
                  _tag: "Headers",
                  headers: state.headers,
                  endPosition: start,
                })
              }

              state.pairs++
              state.key = ""
              state.value = ""
              state.crlf = 0
              state.state = State.key

              continue outer
            }
          }
        }

        if (i === end) {
          state.value += decoder.decode(chunk.slice(start, end))
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
