// hourglass.js — generates the silhouette profile of the glass cavity.
// The SAME profile drives the rendered glass (LatheGeometry) and the physics
// shell (Rapier trimesh), so what you see is exactly what the grains collide with.

import * as THREE from 'three'

// All dimensions in world units. The whole cavity is centred on the origin,
// the throat (neck) sits at y = 0, top pole at +halfHeight, bottom at -halfHeight.
export const DIM = {
  halfHeight: 1.2,    // cavity extends from -1.2 .. +1.2
  bulbRadius: 0.5,    // widest interior radius of each bulb
  neckRadius: 0.082,  // interior radius of the throat opening
  throatHalf: 0.05,   // half-height of the straight throat section
  wall: 0.026,        // glass wall thickness (visual shell)
  fillFraction: 0.8,  // how high (× halfHeight) the resting top pile should reach
}

/**
 * Interior radius as a function of height y (for y >= 0; mirror for the bottom).
 * Smooth blend: straight throat -> flared cone -> rounded bulb -> closed pole.
 */
function innerRadius(y) {
  const { halfHeight, bulbRadius, neckRadius, throatHalf } = DIM
  const ay = Math.abs(y)
  if (ay <= throatHalf) return neckRadius // straight throat

  // normalised position along the bulb, 0 at throat-top, 1 at the pole
  const t = (ay - throatHalf) / (halfHeight - throatHalf)

  // Flare quickly out of the throat, swell to the bulb, then close to the pole.
  // smoothstep-based bump keeps the surface C1-continuous (no physics snags).
  const flare = Math.pow(t, 0.62)            // fast initial flare near the neck
  const close = Math.pow(1 - t, 0.5)         // round the shoulder back to the pole
  const swell = Math.sin(Math.PI * t)        // bulge in the middle of the bulb

  const base = neckRadius + (bulbRadius - neckRadius) * flare * close * 1.0
  const r = base + bulbRadius * 0.16 * swell
  return Math.max(neckRadius * 0.92, r)
}

/**
 * Sample the interior profile as an array of THREE.Vector2(radius, height),
 * ordered bottom pole -> top pole. Poles are pinched to a tiny radius so the
 * surface of revolution is fully closed (sand cannot leak out the ends).
 */
export function buildProfile(segments = 240) {
  const { halfHeight } = DIM
  const pts = []
  const poleR = 0.004 // tiny, not exactly 0, to avoid a degenerate lathe cap
  for (let i = 0; i <= segments; i++) {
    const y = -halfHeight + (2 * halfHeight * i) / segments
    let r = innerRadius(y)
    // pinch the very ends shut
    const edge = (halfHeight - Math.abs(y)) / halfHeight
    if (edge < 0.06) {
      const k = edge / 0.06
      r = poleR + (r - poleR) * k
    }
    pts.push(new THREE.Vector2(Math.max(poleR, r), y))
  }
  return pts
}

/** Outer profile = inner profile pushed outward by the wall thickness (for a glassy shell). */
export function buildOuterProfile(inner) {
  const { wall } = DIM
  const out = []
  for (let i = 0; i < inner.length; i++) {
    const prev = inner[Math.max(0, i - 1)]
    const next = inner[Math.min(inner.length - 1, i + 1)]
    // outward normal of the profile curve in (r, y) space
    const tx = next.x - prev.x
    const ty = next.y - prev.y
    const len = Math.hypot(tx, ty) || 1
    const nx = ty / len // rotate tangent -90° -> points outward (increasing r)
    const ny = -tx / len
    out.push(new THREE.Vector2(inner[i].x + nx * wall, inner[i].y + ny * wall))
  }
  return out
}

/**
 * Revolve a profile into a triangle mesh and return flat arrays suitable for a
 * Rapier trimesh collider: { vertices: Float32Array, indices: Uint32Array }.
 */
export function revolveToTrimesh(profile, radialSegments = 48) {
  const verts = []
  const indices = []
  const rows = profile.length
  for (let i = 0; i < rows; i++) {
    const { x: r, y } = profile[i]
    for (let j = 0; j <= radialSegments; j++) {
      const theta = (j / radialSegments) * Math.PI * 2
      verts.push(Math.cos(theta) * r, y, Math.sin(theta) * r)
    }
  }
  const stride = radialSegments + 1
  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < radialSegments; j++) {
      const a = i * stride + j
      const b = a + 1
      const c = a + stride
      const d = c + 1
      indices.push(a, c, b)
      indices.push(b, c, d)
    }
  }
  return {
    vertices: new Float32Array(verts),
    indices: new Uint32Array(indices),
  }
}

/** Convenience: the y at which the throat opening sits (for gate/metering logic). */
export const THROAT_Y = 0
