// scene.js — Three.js stage: renderer, camera, environment, lighting, the glass
// hourglass body, and its wooden frame. Returns handles the app drives each frame.

import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { buildProfile, buildOuterProfile, DIM } from './hourglass.js'

export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
    stencil: false,
  })
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFShadowMap

  const scene = new THREE.Scene()

  // ----- Environment for crisp glass reflections / refraction -----
  const pmrem = new THREE.PMREMGenerator(renderer)
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
  scene.environment = envTex
  pmrem.dispose() // the baked envTex survives the generator

  // ----- Camera + controls -----
  const camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.05, 100)
  camera.position.set(0, 0.35, 5.2)

  const controls = new OrbitControls(camera, canvas)
  controls.enableDamping = true
  controls.dampingFactor = 0.07
  controls.minDistance = 2.6
  controls.maxDistance = 9
  controls.maxPolarAngle = Math.PI * 0.92
  controls.minPolarAngle = Math.PI * 0.08
  controls.target.set(0, 0, 0)
  controls.autoRotate = false
  controls.autoRotateSpeed = 0.6

  // ----- Lighting -----
  const hemi = new THREE.HemisphereLight(0xdfe9ff, 0x2a2114, 0.55)
  scene.add(hemi)

  const key = new THREE.DirectionalLight(0xfff1d6, 2.4)
  key.position.set(3.2, 5.5, 4)
  key.castShadow = true
  key.shadow.mapSize.set(2048, 2048)
  key.shadow.camera.near = 1
  key.shadow.camera.far = 18
  key.shadow.camera.left = -3
  key.shadow.camera.right = 3
  key.shadow.camera.top = 3
  key.shadow.camera.bottom = -3
  key.shadow.bias = -0.0004
  key.shadow.radius = 4
  scene.add(key)

  const rim = new THREE.DirectionalLight(0x88aaff, 0.8)
  rim.position.set(-4, 1.5, -3)
  scene.add(rim)

  const fill = new THREE.PointLight(0xffca73, 12, 12, 2)
  fill.position.set(-1.5, -1.2, 2.5)
  scene.add(fill)

  // ----- The rig (everything that should flip together) -----
  const rig = new THREE.Group()
  scene.add(rig)

  // ----- Glass body (lathe of the interior profile, given thickness) -----
  const inner = buildProfile(220)
  const outer = buildOuterProfile(inner)
  // outer surface first (back), inner surface (front) — both transmissive.
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0xf4fbff,
    metalness: 0,
    roughness: 0.04,
    transmission: 1.0,
    thickness: 0.5,
    ior: 1.48,
    clearcoat: 1.0,
    clearcoatRoughness: 0.06,
    envMapIntensity: 1.3,
    transparent: true,
    side: THREE.DoubleSide,
  })

  const outerGeo = new THREE.LatheGeometry(outer, 96)
  const innerGeo = new THREE.LatheGeometry(inner, 96)
  const glassOuter = new THREE.Mesh(outerGeo, glassMat)
  const glassInner = new THREE.Mesh(innerGeo, glassMat)
  glassOuter.renderOrder = 2
  glassInner.renderOrder = 3
  rig.add(glassOuter, glassInner)

  // ----- Wooden frame: end caps + corner posts -----
  const woodMat = new THREE.MeshStandardMaterial({
    color: 0x5b3a1e,
    roughness: 0.55,
    metalness: 0.05,
  })
  const brassMat = new THREE.MeshStandardMaterial({
    color: 0xb8893c,
    roughness: 0.35,
    metalness: 0.85,
    envMapIntensity: 1.4,
  })

  const capR = DIM.bulbRadius + 0.16
  const capH = 0.12
  const capY = DIM.halfHeight + 0.02

  function makeCap(y) {
    const g = new THREE.Group()
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(capR, capR * 1.04, capH, 64), woodMat)
    disc.castShadow = true
    disc.receiveShadow = true
    disc.position.y = y
    // a brass ring trim
    const ring = new THREE.Mesh(new THREE.TorusGeometry(capR * 0.92, 0.022, 16, 64), brassMat)
    ring.rotation.x = Math.PI / 2
    ring.position.y = y + (y > 0 ? -capH / 2 : capH / 2)
    g.add(disc, ring)
    return g
  }
  rig.add(makeCap(capY), makeCap(-capY))

  // three corner posts
  const postH = 2 * capY
  const postGeo = new THREE.CylinderGeometry(0.05, 0.05, postH, 20)
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 6
    const post = new THREE.Mesh(postGeo, woodMat)
    post.castShadow = true
    post.position.set(Math.cos(a) * (capR - 0.07), 0, Math.sin(a) * (capR - 0.07))
    rig.add(post)
    // brass ferrules
    for (const yy of [capY - 0.06, -capY + 0.06]) {
      const f = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.062, 0.05, 18), brassMat)
      f.position.set(post.position.x, yy, post.position.z)
      rig.add(f)
    }
  }

  // ----- Ground: a soft shadow-catching pedestal -----
  const groundMat = new THREE.MeshStandardMaterial({ color: 0x0c0f16, roughness: 0.9, metalness: 0.0 })
  const ground = new THREE.Mesh(new THREE.CircleGeometry(6, 64), groundMat)
  ground.rotation.x = -Math.PI / 2
  ground.position.y = -capY - capH / 2 - 0.001
  ground.receiveShadow = true
  scene.add(ground)

  // ----- Resize -----
  // On wide screens the control panel docks to the left, so we shift the rendered
  // hourglass to the RIGHT (camera lens-shift) to centre it in the free space.
  // Mirrors the CSS breakpoint (860px); below that the panel is bottom-centred.
  const LEFT_DOCK_MIN = 760
  function resize() {
    const w = window.innerWidth
    const h = window.innerHeight
    camera.aspect = w / h
    if (w >= LEFT_DOCK_MIN) {
      const shift = Math.min(190, w * 0.13) // ~half the left panel's footprint
      camera.setViewOffset(w, h, -shift, 0, w, h)
    } else {
      camera.clearViewOffset()
    }
    camera.updateProjectionMatrix()
    renderer.setSize(w, h)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  }
  window.addEventListener('resize', resize)
  resize() // apply the initial lens-shift / sizing

  return {
    renderer,
    scene,
    camera,
    controls,
    rig,
    glassMat,
    capY,
    render() {
      controls.update()
      renderer.render(scene, camera)
    },
    resize,
  }
}
