// physics.js — Rapier rigid-body sand with exact-duration metering.
//
// Reconciling "real physics" with "perfectly timed":
//   * Every grain is a real dynamic ball. Top settling, the neck stream and the
//     growing bottom cone are all genuine Rapier simulation.
//   * A self-forming FREEZE-PLUG holds the top pile: any un-released grain that
//     sinks to the throat is pinned (Fixed body), so the pile rests on a plug of
//     grains instead of pouring out on its own.
//   * Flow is a BUDGET locked to the wall clock: by progress p∈[0,1] exactly
//     round(N·p) grains must have been released. To release we un-pin the lowest
//     plug grains; they fall through the REAL neck under gravity (no teleport).
//     The pile above collapses to feed the throat and the next grains re-pin.
//   * So the top empties at exactly p=1 — frame-accurate — while everything you
//     see (funnelling, the falling stream, the piling cone) is simulated.

// SIMD build: API-identical to rapier3d-compat, 2-5x faster for dense contacts.
import RAPIER from '@dimforge/rapier3d-simd-compat'
import { buildProfile, revolveToTrimesh, DIM } from './hourglass.js'

let ready = false
export async function initRapier() {
  if (!ready) {
    await RAPIER.init()
    ready = true
  }
}

const GRAVITY = -6.0 // gentle, "sandy" fall (units/s²); the budget meters timing
const PACKING = 0.62 // settled random-packing fraction — size grains so the
//                      POURED (packed) pile reaches fillFraction, matching top↔bottom
const GRAIN_FRICTION = 0.55 // ~tan(30°): grains slide off the sloped walls to the
//                             centre and heap into a CONE, instead of sticking to the sides

export function createSand(scene, THREE) {
  const world = new RAPIER.World(new RAPIER.Vector3(0, GRAVITY, 0))
  world.timestep = 1 / 120
  try { world.numSolverIterations = 4 } catch {}

  // ---- Static glass shell: grains stay inside this surface of revolution ----
  const profile = buildProfile(220)
  const { vertices, indices } = revolveToTrimesh(profile, 64)
  // NOTE: no TriMeshFlags — FIX_INTERNAL_EDGES makes the mesh one-sided/oriented,
  // and our triangles wind outward, so grains hitting the INSIDE would pass
  // straight through the ignored back-faces. A plain trimesh collides both sides.
  const shellDesc = RAPIER.ColliderDesc.trimesh(vertices, indices).setFriction(0.55).setRestitution(0.02)
  world.createCollider(shellDesc, world.createRigidBody(RAPIER.RigidBodyDesc.fixed()))

  // ---- Grain state ----
  let bodies = []
  let released = [] // has this grain been released to fall through the neck?
  let frozen = []   // is this grain currently pinned as part of the plug?
  let cachedY = null // JS cache of grain Y (updated for awake grains; sleeping ones don't move)
  let cachedR2 = null // JS cache of horizontal radius² (for waking the central feed column)
  let frozenList = [] // indices currently in the throat plug (release source)
  let rGrain = 0.026
  let N = 0
  let releasedCount = 0
  let instanced = null
  const yHoldOffset = () => DIM.throatHalf + rGrain * 1.4 // freeze line, just above throat

  const _q = new THREE.Quaternion()
  const _m = new THREE.Matrix4()
  const _v = new THREE.Vector3()
  const _scale = new THREE.Vector3(1, 1, 1)
  const SAND = [0xe8c074, 0xdca85a, 0xf0d089, 0xcf9a4c, 0xe3b366, 0xf5dca0]

  // analytic interior radius (mirrors hourglass.js, kept local)
  function interiorR(yy) {
    const { halfHeight, bulbRadius, neckRadius, throatHalf } = DIM
    const ay = Math.abs(yy)
    if (ay <= throatHalf) return neckRadius
    const t = (ay - throatHalf) / (halfHeight - throatHalf)
    const flare = Math.pow(t, 0.62)
    const close = Math.pow(1 - t, 0.5)
    const swell = Math.sin(Math.PI * t)
    return Math.max(neckRadius * 0.92, neckRadius + (bulbRadius - neckRadius) * flare * close + bulbRadius * 0.16 * swell)
  }

  // volume of the top cavity from the throat up to a height (numeric integral)
  function fillVolume(yTop) {
    const y0 = DIM.throatHalf
    const steps = 240
    let v = 0
    for (let i = 0; i < steps; i++) {
      const y = y0 + ((yTop - y0) * (i + 0.5)) / steps
      const r = interiorR(y)
      v += Math.PI * r * r * ((yTop - y0) / steps)
    }
    return v
  }

  // choose a grain radius so N grains fill the top bulb to DIM.fillFraction
  function grainRadiusFor(count) {
    const V = fillVolume(DIM.halfHeight * DIM.fillFraction)
    const perGrain = (V * PACKING) / count
    const r = Math.cbrt(perGrain / ((4 / 3) * Math.PI))
    return Math.max(0.011, Math.min(0.05, r))
  }

  function seedPositions() {
    const positions = []
    const spacing = rGrain * 1.96 // near-packed so the initial top ≈ the settled height
    let y = DIM.throatHalf + rGrain * 1.2
    while (positions.length < N && y < DIM.halfHeight - rGrain) {
      const maxR = interiorR(y) - rGrain * 1.1
      if (maxR > rGrain * 0.5) {
        for (let rr = 0; rr <= maxR; rr += spacing) {
          const ring = rr === 0 ? 1 : Math.max(1, Math.floor((2 * Math.PI * rr) / spacing))
          for (let k = 0; k < ring && positions.length < N; k++) {
            const ang = (k / ring) * Math.PI * 2 + y * 3.7
            const j = rGrain * 0.3
            positions.push([
              Math.cos(ang) * rr + (Math.random() - 0.5) * j,
              y + (Math.random() - 0.5) * j,
              Math.sin(ang) * rr + (Math.random() - 0.5) * j,
            ])
          }
        }
      }
      y += spacing * 0.9
    }
    return positions
  }

  function build(count) {
    dispose()
    N = Math.max(50, Math.min(20000, count | 0)) // guard against absurd inputs
    rGrain = grainRadiusFor(N)
    releasedCount = 0
    bodies = new Array(N)
    released = new Array(N).fill(false)
    frozen = new Array(N).fill(false)
    cachedY = new Float32Array(N)
    cachedR2 = new Float32Array(N)
    frozenList = []

    const pos = seedPositions()
    for (let i = 0; i < N; i++) {
      const p = pos[i] || [0, DIM.halfHeight * 0.5, 0]
      cachedY[i] = p[1]
      cachedR2[i] = p[0] * p[0] + p[2] * p[2]
      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(p[0], p[1], p[2])
          .setLinearDamping(0.25)
          .setAngularDamping(0.65)
          .setSoftCcdPrediction(rGrain * 4)
      )
      const col = RAPIER.ColliderDesc.ball(rGrain)
        .setFriction(GRAIN_FRICTION)
        .setRestitution(0.0)
        .setDensity(1.4)
      world.createCollider(col, body)
      bodies[i] = body
    }
    buildInstanced()
    syncAll() // render at the (packed) seed positions immediately — the live loop
    //           then settles them over the next frames, so no blocking settle is needed
  }

  function buildInstanced() {
    if (instanced) {
      scene.remove(instanced)
      instanced.geometry.dispose()
      instanced.material.dispose()
      instanced.dispose() // frees the per-instance matrix/color GPU buffers
    }
    const geo = new THREE.IcosahedronGeometry(rGrain, 0) // faceted grain, 20 tris
    const mat = new THREE.MeshStandardMaterial({
      roughness: 0.95,
      metalness: 0.0,
      flatShading: true,
      envMapIntensity: 0.45,
    })
    instanced = new THREE.InstancedMesh(geo, mat, N)
    instanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    instanced.castShadow = true
    instanced.receiveShadow = true
    instanced.frustumCulled = false // falling grains must not be culled

    const color = new THREE.Color()
    for (let i = 0; i < N; i++) {
      color.setHex(SAND[i % SAND.length])
      color.offsetHSL(0, (Math.random() - 0.5) * 0.05, (Math.random() - 0.5) * 0.09)
      instanced.setColorAt(i, color)
    }
    instanced.instanceColor.needsUpdate = true
    scene.add(instanced)
  }

  function setDynamic(i, wake = true) {
    if (bodies[i].bodyType() !== RAPIER.RigidBodyType.Dynamic) {
      bodies[i].setBodyType(RAPIER.RigidBodyType.Dynamic, wake)
    } else if (wake) bodies[i].wakeUp()
    frozen[i] = false // frozenList entry becomes stale; skipped on pop
  }
  function setFrozen(i) {
    const t = bodies[i].translation()
    cachedY[i] = t.y
    bodies[i].setLinvel({ x: 0, y: 0, z: 0 }, false)
    bodies[i].setAngvel({ x: 0, y: 0, z: 0 }, false)
    bodies[i].setBodyType(RAPIER.RigidBodyType.Fixed, false)
    frozen[i] = true
    frozenList.push(i)
  }

  const THROAT_COL_R2 = () => (DIM.neckRadius * 1.9) ** 2
  // Pin any awake un-released grain that has sunk into the throat column -> keeps
  // the plug fed. Plain loop (NOT forEachActiveRigidBody, which throws a Rapier
  // "recursive use" borrow error when body methods are called inside it). The
  // cheap isSleeping() bool skips the bulk of the sleeping pile.
  function freezePlain() {
    const yHold = yHoldOffset()
    const maxR2 = THROAT_COL_R2()
    for (let i = 0; i < N; i++) {
      if (released[i] || frozen[i] || bodies[i].isSleeping()) continue
      const t = bodies[i].translation()
      if (t.y < yHold && t.x * t.x + t.z * t.z < maxR2) setFrozen(i)
    }
  }

  /**
   * Meter flow to the clock. p∈[0,1]: by p, round(N·p) grains must be released.
   * Releases the lowest plug grains (real falling, no teleport). `complete`
   * forces a hard reconcile so the top is exactly empty on the final frame.
   */
  function meter(p, complete = false) {
    const target = complete ? N : Math.round(N * p)
    let need = target - releasedCount
    if (need <= 0) return
    let rank = 0 // batch position this frame, so a burst stacks instead of clumping

    // (1) release straight from the throat plug — no position reads needed,
    // the frozen grains ARE the lowest grains at the neck.
    while (need > 0 && frozenList.length) {
      const i = frozenList.pop()
      if (released[i] || !frozen[i]) continue // stale entry
      dropThroughNeck(i, rank++)
      releasedCount++
      need--
    }
    // (2) catch-up / hard reconcile: release lowest un-released grains using the
    // cached Y (pure JS — no WASM reads), sorting only the small candidate set.
    if (need > 0) {
      const cands = []
      for (let i = 0; i < N; i++) if (!released[i] && !frozen[i]) cands.push(i)
      cands.sort((a, b) => cachedY[a] - cachedY[b])
      const k = Math.min(need, cands.length)
      for (let n = 0; n < k; n++) {
        dropThroughNeck(cands[n], rank++)
        releasedCount++
      }
    }
    wakeFeedZone()
  }

  // Move a grain across the throat to its exit and let gravity carry it down.
  // The neck crossing is metered (the real neck is a throughput bottleneck);
  // everything below — falling, piling, settling — is genuine simulation.
  // `rank` is the grain's position within this frame's release batch. Stacking a
  // batch into non-overlapping vertical bands stops a large catch-up burst (a
  // backgrounded tab resuming, or the completion frame) from spawning a clump of
  // interpenetrating grains in the tiny neck disc — it streams down instead.
  function dropThroughNeck(i, rank = 0) {
    const band = rank % 18
    const ang = Math.random() * Math.PI * 2
    // a TIGHT central spot so the stream falls vertically down the axis
    const rad = Math.random() * DIM.neckRadius * 0.4
    const yDrop = -DIM.throatHalf - rGrain * 1.6 - band * rGrain * 2.2 - Math.random() * rGrain * 1.2
    const b = bodies[i]
    setDynamic(i, true)
    b.setTranslation({ x: Math.cos(ang) * rad, y: yDrop, z: Math.sin(ang) * rad }, true)
    // drop almost straight down (gravity does the rest) — no sideways throw
    b.setLinvel({ x: (Math.random() - 0.5) * 0.015, y: -0.15, z: (Math.random() - 0.5) * 0.015 }, true)
    released[i] = true
    frozen[i] = false
  }

  // Keep the drain front awake so the pile collapses into the opened plug.
  // Without this a slow (long-timer) drain can leave a sleeping arch hanging over
  // an emptied throat. We wake (a) the band just above the throat AND (b) a narrow
  // CENTRAL COLUMN up the full height — as the funnel drains, that column falls
  // and pulls in the outer grains by contact. Uses the JS caches (no WASM reads);
  // the column is narrow so cost is bounded, and the active pass re-sleeps them.
  function wakeFeedZone() {
    const yWake = DIM.throatHalf + rGrain * 9
    const colR2 = (DIM.neckRadius * 2.2) ** 2
    for (let i = 0; i < N; i++) {
      if (released[i] || frozen[i]) continue
      if (cachedY[i] < yWake || cachedR2[i] < colR2) bodies[i].wakeUp()
    }
  }

  let acc = 0
  function update(dt) {
    if (!instanced) return
    // fixed-step accumulator keeps physics real-time regardless of frame rate
    acc += Math.min(dt, 0.05)
    const h = 1 / 60
    world.timestep = h
    let steps = 0
    while (acc >= h && steps < 3) {
      world.step()
      acc -= h
      steps++
    }
    if (acc > h) acc = 0 // shed backlog so we never spiral
    postStep()
  }

  // ONE O(N) pass per frame doing everything: skip sleeping grains (the cheap
  // isSleeping() bool — no object read), and for each awake grain freeze it if
  // it's an un-released plug grain, rescue it if it escaped, sleep it if it has
  // settled, and sync its instance matrix. A single merged loop means one
  // isSleeping() per grain (not two), and a plain loop avoids the forEach borrow
  // trap, so we can mutate bodies inline.
  const SLEEP_SPEED2 = 0.0025 // (~0.05 u/s)²
  function postStep() {
    const yHold = yHoldOffset()
    const colR2 = THROAT_COL_R2()
    for (let i = 0; i < N; i++) {
      const b = bodies[i]
      if (frozen[i] || b.isSleeping()) continue
      let t = b.translation()
      const rr2 = t.x * t.x + t.z * t.z
      if (!released[i] && t.y < yHold && rr2 < colR2) {
        setFrozen(i) // plug grain (also caches Y) — matrix already correct
        continue
      }
      const escaped =
        t.y < -DIM.halfHeight - 0.02 || t.y > DIM.halfHeight + 0.02 || Math.sqrt(rr2) > interiorR(t.y) + rGrain * 3
      if (escaped) {
        rescue(i, b)
        t = b.translation()
      } else {
        const v = b.linvel()
        if (v.x * v.x + v.y * v.y + v.z * v.z < SLEEP_SPEED2) b.sleep()
      }
      cachedY[i] = t.y
      cachedR2[i] = t.x * t.x + t.z * t.z
      const r = b.rotation()
      _v.set(t.x, t.y, t.z)
      _q.set(r.x, r.y, r.z, r.w)
      _m.compose(_v, _q, _scale)
      instanced.setMatrixAt(i, _m)
    }
    instanced.instanceMatrix.needsUpdate = true
  }

  // Quietly return an escaped grain (rare: one squeezed through the thin neck
  // wall) to a valid spot. Released grains re-enter just below the throat (the
  // top of the falling stream) rather than being injected mid-cone, where they
  // could deep-penetrate the packed pile and thrash. Un-released ones go up top.
  function rescue(i, b) {
    const a = Math.random() * Math.PI * 2
    if (released[i]) {
      const rad = Math.random() * Math.max(0, DIM.neckRadius - rGrain * 1.5)
      b.setTranslation(
        { x: Math.cos(a) * rad, y: -DIM.throatHalf - rGrain * 1.6, z: Math.sin(a) * rad },
        true
      )
      b.setLinvel({ x: 0, y: -0.7, z: 0 }, true)
    } else {
      const y = DIM.halfHeight * 0.7
      const rad = Math.random() * Math.max(0, interiorR(y) - rGrain * 2)
      b.setTranslation({ x: Math.cos(a) * rad, y, z: Math.sin(a) * rad }, true)
      b.setLinvel({ x: 0, y: -0.2, z: 0 }, true)
    }
    b.setAngvel({ x: 0, y: 0, z: 0 }, false)
  }

  // Full sync of every grain's instance matrix — used once after bulk
  // repositioning (build / settle / refill / flip), not per frame.
  function syncAll() {
    for (let i = 0; i < N; i++) {
      const t = bodies[i].translation()
      const r = bodies[i].rotation()
      _v.set(t.x, t.y, t.z)
      _q.set(r.x, r.y, r.z, r.w)
      _m.compose(_v, _q, _scale)
      instanced.setMatrixAt(i, _m)
    }
    instanced.instanceMatrix.needsUpdate = true
  }

  function settle(steps = 90) {
    const prev = world.timestep
    world.timestep = 1 / 120
    for (let s = 0; s < steps; s++) {
      freezePlain()
      world.step()
    }
    world.timestep = prev
    rescueAllEscaped() // never leave a grain outside the glass after a (re)settle
    if (instanced) syncAll()
  }

  // Full sweep (all grains, not just awake) returning any escapee to a valid spot.
  // Run after bulk repositioning/settling — e.g. a flip — so nothing is left
  // outside the glass before the next render (prevents the "spill on flip").
  function rescueAllEscaped() {
    for (let i = 0; i < N; i++) {
      const t = bodies[i].translation()
      const rr = Math.hypot(t.x, t.z)
      if (t.y < -DIM.halfHeight - 0.02 || t.y > DIM.halfHeight + 0.02 || rr > interiorR(t.y) + rGrain * 3) {
        rescue(i, bodies[i])
      }
    }
  }

  // Re-seed every grain into a full top bulb and reset metering.
  function refill() {
    releasedCount = 0
    frozenList = []
    const pos = seedPositions()
    for (let i = 0; i < N; i++) {
      const p = pos[i] || [0, DIM.halfHeight * 0.5, 0]
      const b = bodies[i]
      setDynamic(i, false)
      b.setTranslation({ x: p[0], y: p[1], z: p[2] }, false)
      b.setLinvel({ x: 0, y: 0, z: 0 }, false)
      b.setAngvel({ x: 0, y: 0, z: 0 }, false)
      b.setRotation({ x: 0, y: 0, z: 0, w: 1 }, false)
      cachedY[i] = p[1]
      cachedR2[i] = p[0] * p[0] + p[2] * p[2]
      released[i] = false
      frozen[i] = false
      b.wakeUp()
    }
    if (instanced) syncAll() // show the refilled pile at once; the loop settles it live
  }

  function setVisualRotationZ(rad) {
    if (instanced) instanced.rotation.z = rad
  }

  // Bake a half-turn about Z (R_π) so the pile that was at the BOTTOM becomes a
  // full TOP pile — the seamless, physical result of flipping a drained glass.
  // If the flip would instead leave the sand at the bottom (you flipped one that
  // was still full up top), re-seed the top so it always ends ready to run.
  function commitFlip() {
    frozenList = []
    let topAfter = 0
    for (let i = 0; i < N; i++) {
      const b = bodies[i]
      const t = b.translation()
      const ny = -t.y
      setDynamic(i, false)
      b.setTranslation({ x: -t.x, y: ny, z: t.z }, false) // R_π about Z
      b.setLinvel({ x: 0, y: 0, z: 0 }, false)
      b.setAngvel({ x: 0, y: 0, z: 0 }, false)
      b.setRotation({ x: 0, y: 0, z: 0, w: 1 }, false)
      cachedY[i] = ny
      cachedR2[i] = t.x * t.x + t.z * t.z // R_π about Z preserves horizontal radius
      released[i] = false
      frozen[i] = false
      b.wakeUp()
      if (ny > DIM.throatHalf) topAfter++ // count grains genuinely in the top bulb
    }
    releasedCount = 0
    // A flip should always end ready (full top). Only the seamless drained-glass
    // case (almost everything maps above the throat) keeps the baked R_π pile;
    // a partial flip re-seeds so half the sand can't end up stranded at the bottom.
    if (topAfter < N * 0.9) refill()
    settle(40)
  }

  function dispose() {
    if (bodies) for (const b of bodies) if (b) world.removeRigidBody(b)
    bodies = []
    if (instanced) {
      scene.remove(instanced)
      instanced.geometry.dispose()
      instanced.material.dispose()
      instanced.dispose() // frees per-instance matrix/color GPU buffers
      instanced = null
    }
  }

  return {
    build,
    refill,
    meter,
    update,
    settle,
    setVisualRotationZ,
    commitFlip,
    get grainCount() { return N },
    get releasedCount() { return releasedCount },
    get grainRadius() { return rGrain },
    debugStats() {
      let minY = Infinity, maxY = -Infinity, maxR = 0
      let top = 0, bottom = 0, belowGlass = 0, outside = 0, frz = 0, awake = 0
      for (let i = 0; i < N; i++) {
        const t = bodies[i].translation()
        const rr = Math.hypot(t.x, t.z)
        minY = Math.min(minY, t.y); maxY = Math.max(maxY, t.y); maxR = Math.max(maxR, rr)
        if (frozen[i]) frz++
        if (!bodies[i].isSleeping()) awake++
        if (t.y > DIM.throatHalf) top++
        else if (t.y > -DIM.halfHeight) bottom++
        if (t.y < -DIM.halfHeight) belowGlass++
        if (rr > interiorR(t.y) + rGrain * 2) outside++
      }
      return {
        N, rGrain: +rGrain.toFixed(4), releasedCount, frozen: frz, awake,
        minY: +minY.toFixed(3), maxY: +maxY.toFixed(3), maxR: +maxR.toFixed(3),
        top, bottom, belowGlass, outside, halfHeight: DIM.halfHeight, bulbR: DIM.bulbRadius,
      }
    },
  }
}
