// main.js — wires the stage, the sand physics, the clock and the UI together.

import * as THREE from 'three'
import { createScene } from './scene.js'
import { createSand, initRapier } from './physics.js'
import { createTimer } from './timer.js'
import { createUI } from './ui.js'

const DEFAULT_SECONDS = 60
const DEFAULT_GRAINS = 2800

async function boot() {
  // These are populated after Rapier initialises; the UI handlers below close
  // over them and only fire on user interaction, by which point they exist.
  let sand = null
  let timer = null
  let grains = DEFAULT_GRAINS
  let flip = null // { t, from, dur } while a flip animation runs
  let done = false
  let ui = null

  // Grain size may only change when the glass is at rest (fresh-full or done) —
  // rebuilding mid-drain would reset the release budget and dump the backlog.
  function canChangeGrains() {
    return !!timer && !flip && !timer.isRunning && (timer.elapsed === 0 || timer.isComplete)
  }
  function syncGrainAccess() {
    if (ui) ui.setQualityEnabled(canChangeGrains())
  }

  function refreshIdle(statusText = 'Ready') {
    done = false
    ui.setDone(false)
    ui.setRunning(false)
    ui.setStatus(statusText)
    ui.setRemaining(timer.remaining)
    syncGrainAccess()
  }

  function resetSand() {
    sand.refill()
    sand.settle(60)
  }

  const handlers = {
    onSetDuration(seconds) {
      if (!timer || flip) return
      timer.setDuration(seconds)
      resetSand()
      refreshIdle()
    },
    onSetGrains(count) {
      if (!sand || !canChangeGrains()) return // ignored while a drain is in progress
      grains = count
      sand.build(count)
      sand.settle(120)
      timer.reset()
      refreshIdle()
    },
    onStart() {
      if (!timer || timer.isComplete) return
      timer.start()
      ui.setRunning(true)
      ui.setStatus('Running')
      syncGrainAccess()
    },
    onPause() {
      if (!timer) return
      timer.pause()
      ui.setRunning(false)
      ui.setStartLabel('Resume')
      ui.setStatus('Paused')
      syncGrainAccess()
    },
    onToggle() {
      if (!timer) return
      if (timer.isRunning) handlers.onPause()
      else handlers.onStart()
    },
    onReset() {
      if (!timer) return
      timer.reset()
      resetSand()
      refreshIdle()
    },
    onFlip() {
      if (!sand || flip) return
      timer.pause()
      timer.reset()
      ui.setStatus('Flipping')
      ui.setDone(false)
      ui.setRunning(false)
      flip = { t: 0, from: stage.rig.rotation.z, dur: 0.95 }
      syncGrainAccess()
    },
  }

  const canvas = document.getElementById('scene')
  const stage = createScene(canvas)
  ui = createUI(handlers)

  // Rapier WASM must initialise before we can build bodies.
  await initRapier()
  sand = createSand(stage.scene, THREE)
  sand.build(DEFAULT_GRAINS)
  sand.settle(120)
  if (import.meta.env.DEV) {
    window.__sand = sand
    window.__stage = stage
  }

  timer = createTimer(DEFAULT_SECONDS)

  ui.setActiveDuration(DEFAULT_SECONDS)
  ui.setActiveGrains(DEFAULT_GRAINS)
  ui.setRemaining(timer.remaining)
  ui.setStatus('Ready')
  syncGrainAccess()
  ui.hideLoader()
  ui.fadeHint()

  // ---- main loop ----
  let last = performance.now()
  const easeInOut = (x) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2)

  function frame() {
    const now = performance.now()
    const dt = Math.min((now - last) / 1000, 0.05)
    last = now

    if (flip) {
      // freeze physics; rotate the rig + grain cloud together about Z. The glass
      // is symmetric under a half-turn about Z, so containment stays valid.
      flip.t += dt
      const a = easeInOut(Math.min(1, flip.t / flip.dur))
      stage.rig.rotation.z = flip.from + a * Math.PI
      sand.setVisualRotationZ(a * Math.PI)
      if (flip.t >= flip.dur) {
        sand.commitFlip() // bake the half-turn into the physics bodies
        stage.rig.rotation.z = 0
        sand.setVisualRotationZ(0)
        timer.reset()
        refreshIdle()
        flip = null
      }
    } else {
      timer.tick()
      if (timer.elapsed > 0) sand.meter(timer.progress(), timer.isComplete)
      sand.update(dt)

      ui.setRemaining(timer.remaining)
      if (timer.isComplete && !done) {
        done = true
        ui.setDone(true)
        ui.setRunning(false)
        ui.setStartLabel('Done')
        ui.setStartEnabled(false) // inert while complete — use Flip / Reset
        ui.setStatus('Done')
        syncGrainAccess() // re-enable grain-size now that the drain is finished
      }
    }

    stage.render()
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}

boot().catch((err) => {
  console.error(err)
  const loader = document.getElementById('loader')
  if (loader) loader.querySelector('.loader__text').textContent = 'Failed to load — see console.'
})
