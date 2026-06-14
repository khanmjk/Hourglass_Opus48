# ⏳ Sands of Time — a digital-twin hourglass timer

[![Live Demo](https://img.shields.io/badge/Live_Demo-Run_it_in_your_browser-2ea44f?style=for-the-badge&logo=googlechrome&logoColor=white)](https://khanmjk.github.io/Hourglass_Opus48/)
&nbsp;[![Deploy](https://github.com/khanmjk/Hourglass_Opus48/actions/workflows/deploy.yml/badge.svg)](https://github.com/khanmjk/Hourglass_Opus48/actions/workflows/deploy.yml)

A single-page web app that renders a **3D hourglass whose sand is thousands of real
rigid-body grains**. Pick a duration, press start, and the sand pours from the top
bulb, through the neck, and heaps up in the bottom — funnelling, streaming and piling
with genuine physics — yet it empties at **exactly** the time you set, every time.

It runs **entirely in your browser**. No server, no backend, no build step required at
runtime — just static files (HTML/JS/WASM). The physics and rendering happen 100%
client-side.

### ▶ Live demo: **https://khanmjk.github.io/Hourglass_Opus48/**

(Auto-deployed to GitHub Pages on every push to `main` via [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml).)

> Built in a single session with Claude (Opus 4.8, “Ultracode” mode). The full
> story — the research, the architecture, the maths, the dead-ends and the fixes —
> is written up in the accompanying blog post.

<!-- Tip: add a hero screenshot or GIF here, e.g. ![Sands of Time](docs/hero.png) -->

## ✨ Features

- **Real grain physics** — every grain is a dynamic rigid body (not a shader trick).
  The top pile funnels, a stream falls through the neck, and the bottom grows into a
  cone.
- **Perfectly timed** — the top empties frame-accurately at `00:00` for any duration,
  independent of frame rate, pauses or device speed.
- **Durations** — 1 / 3 / 5 / 10 / 30 / 60-minute presets, or a custom `min : sec`.
- **Flip** — tumble the glass; drained sand returns to the top, ready to run again.
- **Grain size** — Fine / Medium / Coarse (changes how many — and therefore how big —
  the grains are; the bulb always looks equally full).
- **Transport** — Start / Pause / Reset, plus orbit + zoom (drag / scroll).

## 🚀 Run it

Requires [Node.js](https://nodejs.org) 18+.

```bash
npm install
npm run dev      # open http://localhost:5173
```

Production build (a static bundle — host it anywhere, or open the built `index.html`):

```bash
npm run build
npm run preview  # serves the production build locally
```

Keyboard: `Space` start/pause · `R` reset · `F` flip.

## 🧠 How it works — real physics that stays *perfectly timed*

A real hourglass empties at a roughly **constant rate**: granular flow through an
aperture is (to first order) independent of how much sand is stacked above it —
**Beverloo's law**. So a *linear* emptying schedule is physically faithful, and that's
the key that lets us reconcile "obeys real physics" with "finishes at exactly T":

1. **The grains are real.** Each is a dynamic ball collider inside a trimesh glass
   shell. Settling, funnelling, the falling stream and the growing heap are all
   simulated by Rapier.
2. **A self-forming "freeze-plug" holds the top pile.** Any un-released grain that
   sinks into the throat is pinned (turned into a `Fixed` body), so the pile rests on a
   plug of grains instead of pouring out on its own.
3. **Flow is a budget locked to the wall clock.** By progress `p ∈ [0,1]`, exactly
   `round(N · p)` grains must have been released. Each frame we release the shortfall
   by un-pinning the lowest plug grains and metering them across the throat; gravity
   then carries them down and they pile up for real. Because the *count* is driven by
   elapsed time, the top empties **frame-accurately at `p = 1`** — while everything you
   *see* is genuine simulation.

The single metered step is the neck crossing (a real neck is a throughput bottleneck;
metering it is what lets a 1-minute and a 60-minute timer share the same glass).
Funnelling, falling, settling and heaping are all emergent.

### Grain sizing maths

The bulb should always look equally full regardless of the detail tier, so grain
**radius is derived from the count**, not fixed. Given a target fill volume `V` (the
cavity from the throat up to `fillFraction`, computed by integrating the lathe profile)
and a settled packing fraction `φ ≈ 0.62`:

```
grainVolume = V · φ / N        ⇒    r = ∛( grainVolume / (4/3·π) )
```

So Fine (more grains) ⇒ smaller `r`; Coarse (fewer) ⇒ chunkier `r`; both fill to the
same height.

### Performance

Only the **active** grains — the funnel front, the falling stream and the impact zone —
are simulated each frame; settled grains are force-slept and skipped. Combined with a
fixed-step accumulator, a JS-side position cache (to avoid per-frame WASM boundary
calls) and single-draw-call instancing, the default tier holds ~60 fps on a modern
laptop. The timing is driven by the wall clock, so even if the frame rate dips the sand
levels stay correct.

## 🛠️ Tech stack — and why

| Layer | Choice | Why |
|---|---|---|
| Rendering | [**three.js**](https://threejs.org) `0.184` | The de-facto WebGL library. Glass is a `LatheGeometry` + `MeshPhysicalMaterial` (transmission/IOR); all grains are one `InstancedMesh` (one draw call). |
| Physics | [**Rapier**](https://rapier.rs) `0.19` (`@dimforge/rapier3d-simd-compat`) | Rust→WASM rigid-body engine; the SIMD build is the fastest in-browser option for thousands of mutually-colliding bodies, and the `-compat` package inlines its WASM so it bundles anywhere. |
| Build / dev | [**Vite**](https://vitejs.dev) `8` | Instant dev server + a clean static production build. |

No framework, no backend — vanilla ES modules driving the canvas directly.

## 📁 Project layout

| File | Role |
|---|---|
| `src/main.js` | wires stage + physics + clock + UI; the animation loop and flip |
| `src/scene.js` | renderer, camera, lights, environment, glass body, wooden frame |
| `src/hourglass.js` | the silhouette profile shared by the glass mesh **and** the physics shell |
| `src/physics.js` | Rapier world, grains, the freeze-plug, the exact-timing meter |
| `src/timer.js` | the authoritative countdown clock |
| `src/ui.js` | control-panel + HUD wiring |

## 👍 Strengths & 👎 limitations

**Strengths**
- 100% client-side SPA — physics + rendering run entirely in the browser; the build is
  static and host-anywhere.
- Genuinely physical: real rigid-body grains, not a sprite or shader fake.
- Exact timing for *any* duration, decoupled from frame rate.
- Adaptive grain sizing keeps the glass looking full at every detail tier.

**Limitations / trade-offs**
- "Sand" is coarse by necessity — real sand has millions of grains; rigid-body physics
  is comfortable with a few thousand, so the grains read more like fine gravel.
- The neck crossing is *metered* rather than purely emergent (a single narrow aperture
  can't naturally serve both a 1-min and a 60-min pour from one geometry).
- A handful of grains can squeeze through the thin trimesh wall under pressure; a
  safety sweep quietly returns any escapee to its pile.
- Very short timers (a few seconds) pour fast enough to look chunky; the design targets
  the minute-scale durations a real hourglass is used for.

## License

MIT
