// ui.js — control-panel + HUD wiring. Pure DOM; talks to the app via callbacks.

export function formatTime(seconds) {
  const s = Math.max(0, Math.ceil(seconds))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
}

export function createUI(handlers) {
  const $ = (sel) => document.querySelector(sel)

  const el = {
    presets: $('#presets'),
    quality: $('#quality'),
    customMin: $('#custom-min'),
    customSec: $('#custom-sec'),
    applyCustom: $('#apply-custom'),
    start: $('#btn-start'),
    pause: $('#btn-pause'),
    flip: $('#btn-flip'),
    reset: $('#btn-reset'),
    timeRemaining: $('#time-remaining'),
    timeStatus: $('#time-status'),
    countdown: $('#countdown'),
    loader: $('#loader'),
    hint: $('#hint'),
  }

  // ----- Duration presets -----
  const presetChips = [...el.presets.querySelectorAll('.chip')]
  function highlightDuration(seconds) {
    let matched = false
    for (const chip of presetChips) {
      const active = Number(chip.dataset.seconds) === seconds
      chip.classList.toggle('is-active', active)
      matched ||= active
    }
    // reflect into the custom inputs too
    el.customMin.value = Math.floor(seconds / 60)
    el.customSec.value = seconds % 60
    return matched
  }

  el.presets.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip')
    if (!chip) return
    const seconds = Number(chip.dataset.seconds)
    highlightDuration(seconds)
    handlers.onSetDuration?.(seconds)
  })

  el.applyCustom.addEventListener('click', () => {
    const m = Math.max(0, Math.min(180, Number(el.customMin.value) || 0))
    const s = Math.max(0, Math.min(59, Number(el.customSec.value) || 0))
    const seconds = Math.min(180 * 60, Math.max(1, m * 60 + s)) // clamp to [1s, 180min]
    highlightDuration(seconds)
    handlers.onSetDuration?.(seconds)
  })

  // ----- Quality / grain count -----
  const qualityChips = [...el.quality.querySelectorAll('.chip')]
  function highlightQuality(grains) {
    for (const chip of qualityChips) {
      chip.classList.toggle('is-active', Number(chip.dataset.grains) === grains)
    }
  }
  el.quality.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip')
    if (!chip) return
    const grains = Number(chip.dataset.grains)
    highlightQuality(grains)
    handlers.onSetGrains?.(grains)
  })

  // ----- Transport controls -----
  el.start.addEventListener('click', () => handlers.onStart?.())
  el.pause.addEventListener('click', () => handlers.onPause?.())
  el.flip.addEventListener('click', () => handlers.onFlip?.())
  el.reset.addEventListener('click', () => handlers.onReset?.())

  // keyboard: space = start/pause, r = reset, f = flip
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return
    if (e.code === 'Space') {
      e.preventDefault()
      handlers.onToggle?.()
    } else if (e.key === 'r' || e.key === 'R') {
      handlers.onReset?.()
    } else if (e.key === 'f' || e.key === 'F') {
      handlers.onFlip?.()
    }
  })

  // ----- Public API used by the app -----
  return {
    setRemaining(seconds) {
      el.timeRemaining.textContent = formatTime(seconds)
    },
    setStatus(text) {
      el.timeStatus.textContent = text
    },
    setActiveDuration(seconds) {
      highlightDuration(seconds)
    },
    setActiveGrains(grains) {
      highlightQuality(grains)
    },
    setQualityEnabled(on) {
      for (const chip of qualityChips) chip.disabled = !on
    },
    setDone(done) {
      el.countdown.classList.toggle('is-done', done)
    },
    // running -> show pause enabled, start shows "Resume" label semantics
    setRunning(running) {
      el.pause.disabled = !running
      el.start.querySelector('.btn__label').textContent = running ? 'Running' : 'Start'
      el.start.disabled = running
    },
    setStartLabel(label) {
      el.start.querySelector('.btn__label').textContent = label
    },
    setStartEnabled(on) {
      el.start.disabled = !on
    },
    hideLoader() {
      el.loader.classList.add('is-hidden')
      setTimeout(() => (el.loader.style.display = 'none'), 700)
    },
    fadeHint() {
      setTimeout(() => (el.hint.style.opacity = '0'), 6000)
    },
  }
}
