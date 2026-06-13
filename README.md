# Sands of Time — a digital-twin hourglass timer

A single-page web app that renders a 3D hourglass whose sand is **thousands of
real rigid-body grains**. Pick a duration, press start, and the sand pours from
the top bulb, through the neck, and piles up in the bottom — funnelling,
streaming and heaping with genuine physics — yet it empties at **exactly** the
time you set, every time.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
```

Production build (static, works from any host or file path):

```bash
npm run build && npm run preview
```

## Controls

- **Duration** — 1 / 3 / 5 / 10 / 30 / 60 min presets, or a custom min : sec.
- **Start / Pause / Reset** — transport. `Space` toggles, `R` resets, `F` flips.
- **Flip** — tumble the glass; drained sand returns to the top, ready to run again.
- **Sand detail** — Smooth / Balanced / Dense changes grain count (and therefore
  fineness); the bulb always looks equally full.
- Drag to orbit, scroll to zoom.

## Tech

- **[three.js](https://threejs.org)** `0.184` — rendering. The glass is a
  `LatheGeometry` with a `MeshPhysicalMaterial` (transmission/IOR) inside a
  wooden + brass frame, lit by a `RoomEnvironment`. All grains are drawn in one
  `InstancedMesh` draw call.
- **[Rapier](https://rapier.rs)** `0.19` (`@dimforge/rapier3d-simd-compat`, the
  SIMD WASM build) — rigid-body physics for every grain.
- **[Vite](https://vitejs.dev)** `8` — dev server / bundler.

## How real physics stays *perfectly timed*

A real hourglass empties at a roughly **constant rate** — granular flow through
an aperture is independent of how much sand is stacked above it (Beverloo's law),
so a linear schedule is physically faithful. We exploit that:

1. **The grains are real.** Each is a dynamic ball collider. The top pile
   settles, funnels and collapses; the neck stream falls; the bottom heap grows
   into a cone — all simulated by Rapier inside a trimesh glass shell.
2. **A self-forming freeze-plug** holds the top pile. Any un-released grain that
   sinks into the throat is pinned (a `Fixed` body), so the pile rests on a plug
   of grains instead of pouring out on its own.
3. **Flow is a budget locked to the wall clock.** By progress `p ∈ [0,1]`,
   exactly `round(N·p)` grains must have been released. Each frame we release the
   shortfall by un-pinning the lowest plug grains and metering them across the
   throat; gravity carries them down and they pile up for real. Because the count
   is driven by elapsed time, the top empties **frame-accurately at `p = 1`**,
   independent of frame rate, pauses, or device speed — while everything you see
   is simulated.

The neck crossing is the only metered step (a real neck is a throughput
bottleneck; metering it is what lets a 1-minute and a 60-minute timer share the
same glass). Funnelling, falling, settling and heaping are all genuine.

### Performance

Only the **active grains** — the funnel front, the falling stream and the impact
zone — are ever simulated; settled grains are force-slept and skipped entirely.
Combined with a fixed-step accumulator, a JS-side position cache (to avoid
per-frame WASM boundary calls) and single-draw-call instancing, the per-frame
cost is a few milliseconds even at the Dense tier.

## Project layout

| File | Role |
|------|------|
| `src/main.js` | wires stage + physics + clock + UI; the animation loop and flip |
| `src/scene.js` | renderer, camera, lights, environment, glass body, frame |
| `src/hourglass.js` | the silhouette profile shared by the glass mesh and the physics shell |
| `src/physics.js` | Rapier world, grains, freeze-plug, the exact-timing meter |
| `src/timer.js` | the authoritative countdown clock |
| `src/ui.js` | control-panel + HUD wiring |

## License

MIT
