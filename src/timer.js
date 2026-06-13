// timer.js — authoritative wall-clock for the countdown.
// The physics layer reads `progress()` to decide how much sand should have
// passed, so the sand stays locked to real elapsed time regardless of frame rate.

export function createTimer(durationSeconds) {
  let duration = durationSeconds
  let elapsed = 0 // seconds of "running" time accumulated
  let running = false
  let lastStamp = null // performance.now() at last tick while running

  return {
    get duration() {
      return duration
    },
    setDuration(seconds) {
      duration = Math.max(1, seconds)
      this.reset()
    },
    start() {
      if (running) return
      running = true
      lastStamp = performance.now()
    },
    pause() {
      if (!running) return
      // fold the in-flight slice into elapsed before stopping
      const now = performance.now()
      elapsed += (now - lastStamp) / 1000
      lastStamp = null
      running = false
    },
    reset() {
      elapsed = 0
      running = false
      lastStamp = null
    },
    /** Advance the clock; call once per animation frame. Returns elapsed seconds. */
    tick() {
      if (running) {
        const now = performance.now()
        elapsed += (now - lastStamp) / 1000
        lastStamp = now
        if (elapsed >= duration) {
          elapsed = duration
          running = false
          lastStamp = null
        }
      }
      return elapsed
    },
    get isRunning() {
      return running
    },
    get elapsed() {
      return elapsed
    },
    get remaining() {
      return Math.max(0, duration - elapsed)
    },
    /** 0 at start, 1 when complete. */
    progress() {
      return duration > 0 ? Math.min(1, elapsed / duration) : 1
    },
    get isComplete() {
      return elapsed >= duration
    },
  }
}
