import * as THREE from 'three';
import { EffectComposer }  from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass }      from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

// ── Renderer ──────────────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping         = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace    = THREE.SRGBColorSpace;

// mix-blend-mode: screen makes black pixels transparent against DOM layers
// behind this canvas (webcam video, 2D landmark canvas).
Object.assign(renderer.domElement.style, {
  position:     'absolute',
  inset:        '0',
  zIndex:       '5',
  pointerEvents:'none',
  mixBlendMode: 'screen',
});
document.body.appendChild(renderer.domElement);

// ── Scene / Camera ────────────────────────────────────────────────────────────
const scene  = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.z = 5;

// Half the frustum height at z=0 (camera at z=5, FOV 60)
const HALF_H = Math.tan(Math.PI / 6) * 5; // ≈ 2.887

const lerp = (a, b, t) => a + (b - a) * t;

// ── Post-processing ───────────────────────────────────────────────────────────
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  1.8,   // strength
  0.8,   // radius
  0.0,   // threshold — bloom everything
);
composer.addPass(bloom);

console.log('[HandSynth] EffectComposer ready. UnrealBloomPass added (strength=1.8, radius=0.8, threshold=0). composer.render() is active.');

// ── Resize ────────────────────────────────────────────────────────────────────
window.addEventListener('resize', () => {
  const W = window.innerWidth, H = window.innerHeight;
  camera.aspect = W / H;
  camera.updateProjectionMatrix();
  renderer.setSize(W, H);
  composer.setSize(W, H);
});

// ── Shared coordinate helper ──────────────────────────────────────────────────
// Convert a normalized MediaPipe landmark to Three.js world-space coords.
// Mirrors x to match the flipped video display.
function mpToWorld(lm) {
  return {
    x: (0.5 - lm.x) * 2 * HALF_H * camera.aspect,
    y: (0.5 - lm.y) * 2 * HALF_H,
    z: (lm.z || 0) * 0.5,
  };
}

// ── Icosahedron ───────────────────────────────────────────────────────────────
const icoGeo  = new THREE.IcosahedronGeometry(1.5, 4);
const origPos = icoGeo.attributes.position.array.slice();
const icoMat  = new THREE.MeshBasicMaterial({ color: 0x00ffff, wireframe: true });
const icoMesh = new THREE.Mesh(icoGeo, icoMat);
scene.add(icoMesh);

const LOG_FREQ_MIN = Math.log(130.81); // C3
const LOG_FREQ_MAX = Math.log(880.0);  // A5

// Smoothed icosahedron state
let icoRotX = 0, icoRotY = 0;
let icoTgtRotX = 0, icoTgtRotY = 0;
let icoPosX = 0, icoPosY = 0, icoPosZ = 0;
let icoScale = 0.4;

function updateIco(fftData, state) {
  const posArr = icoGeo.attributes.position.array;
  const N      = posArr.length / 3;

  // Audio-reactive vertex displacement
  if (fftData) {
    for (let i = 0; i < N; i++) {
      const ox = origPos[i * 3], oy = origPos[i * 3 + 1], oz = origPos[i * 3 + 2];
      const r  = Math.sqrt(ox * ox + oy * oy + oz * oz);
      const nx = ox / r, ny = oy / r, nz = oz / r;

      const theta  = Math.atan2(nz, nx) + Math.PI;
      const binIdx = Math.floor(theta / (2 * Math.PI) * fftData.length) % fftData.length;
      const db     = fftData[binIdx];
      const amp    = isFinite(db) ? Math.max(0, (db + 80) / 80) : 0;
      const scale  = r * (1 + amp * 0.25);

      posArr[i * 3]     = nx * scale;
      posArr[i * 3 + 1] = ny * scale;
      posArr[i * 3 + 2] = nz * scale;
    }
    icoGeo.attributes.position.needsUpdate = true;
  }

  // Hue from average pitch of both voices
  const lf  = state?.leadFreq || 261.63;
  const bf  = state?.bassFreq || 130.81;
  const hue = Math.max(0, Math.min(1,
    ((Math.log(lf) + Math.log(bf)) / 2 - LOG_FREQ_MIN) / (LOG_FREQ_MAX - LOG_FREQ_MIN)
  ));
  icoMesh.material.color.setHSL(hue, 1.0, 0.5).multiplyScalar(2.5); // HDR for bloom

  // Hand-driven rotation, position, and scale
  const hands = state?.handsData || [];

  if (hands.length > 0) {
    let sumMirX = 0, sumWristY = 0;
    let sumWpX  = 0, sumWpY   = 0, sumWpZ = 0;
    let sumPinch = 0;

    for (const hand of hands) {
      const w = hand.landmarks[0];
      sumMirX   += 1 - w.x;
      sumWristY += w.y;
      const wp   = mpToWorld(w);
      sumWpX    += wp.x;
      sumWpY    += wp.y;
      sumWpZ    += wp.z;
      sumPinch  += hand.smoothPinch;
    }

    const n = hands.length;
    icoTgtRotY = (sumMirX   / n - 0.5) * 2 * Math.PI;
    icoTgtRotX = (sumWristY / n - 0.5) * 2 * Math.PI;
    icoScale   = lerp(icoScale, 0.4 + (sumPinch / n) * 0.5, 0.1);

    const tgtX = Math.max(-2.5, Math.min(2.5, (sumWpX / n) * 0.5));
    const tgtY = Math.max(-1.5, Math.min(1.5, (sumWpY / n) * 0.5));
    icoPosX = lerp(icoPosX, tgtX, 0.1);
    icoPosY = lerp(icoPosY, tgtY, 0.1);
    icoPosZ = lerp(icoPosZ, sumWpZ / n, 0.1);
  } else {
    icoPosX  = lerp(icoPosX,  0, 0.1);
    icoPosY  = lerp(icoPosY,  0, 0.1);
    icoPosZ  = lerp(icoPosZ,  0, 0.1);
    icoScale = lerp(icoScale, 0.4, 0.1);
  }

  icoRotX = lerp(icoRotX, icoTgtRotX, 0.15);
  icoRotY = lerp(icoRotY, icoTgtRotY, 0.15);
  icoMesh.rotation.x = icoRotX;
  icoMesh.rotation.y = icoRotY;
  icoMesh.position.set(icoPosX, icoPosY, icoPosZ);
  icoMesh.scale.setScalar(icoScale);
}

// ── Particles ─────────────────────────────────────────────────────────────────
const MAX_P = 2000;

const pLife  = new Float32Array(MAX_P);
const pPosX  = new Float32Array(MAX_P);
const pPosY  = new Float32Array(MAX_P);
const pPosZ  = new Float32Array(MAX_P);
const pVelX  = new Float32Array(MAX_P);
const pVelY  = new Float32Array(MAX_P);
const pVelZ  = new Float32Array(MAX_P);
const pBaseR = new Float32Array(MAX_P);
const pBaseG = new Float32Array(MAX_P);
const pBaseB = new Float32Array(MAX_P);
let   pNext  = 0;

const geoPos   = new Float32Array(MAX_P * 3);
const geoColor = new Float32Array(MAX_P * 3);
const geoSize  = new Float32Array(MAX_P);

const pGeo = new THREE.BufferGeometry();
pGeo.setAttribute('position', new THREE.BufferAttribute(geoPos,   3).setUsage(THREE.DynamicDrawUsage));
pGeo.setAttribute('aColor',   new THREE.BufferAttribute(geoColor, 3).setUsage(THREE.DynamicDrawUsage));
pGeo.setAttribute('aSize',    new THREE.BufferAttribute(geoSize,  1).setUsage(THREE.DynamicDrawUsage));

const pMat = new THREE.ShaderMaterial({
  vertexShader: `
    attribute float aSize;
    attribute vec3  aColor;
    varying   vec3  vColor;
    void main() {
      vColor = aColor;
      vec4 mvPos   = modelViewMatrix * vec4(position, 1.0);
      gl_PointSize = aSize * (300.0 / -mvPos.z);
      gl_Position  = projectionMatrix * mvPos;
    }
  `,
  fragmentShader: `
    varying vec3 vColor;
    void main() {
      float d = length(gl_PointCoord - vec2(0.5));
      if (d > 0.5) discard;
      float alpha = 1.0 - smoothstep(0.25, 0.5, d);
      gl_FragColor = vec4(vColor * alpha, 1.0);
    }
  `,
  blending:    THREE.AdditiveBlending,
  depthWrite:  false,
  transparent: true,
});

scene.add(new THREE.Points(pGeo, pMat));

const TIPS = [4, 8, 12, 16, 20];

function spawnParticle(x, y, z, r, g, b) {
  const i   = pNext;
  pNext     = (pNext + 1) % MAX_P;
  pLife[i]  = 1.5;
  pPosX[i]  = x; pPosY[i] = y; pPosZ[i] = z;
  pVelX[i]  = (Math.random() - 0.5) * 1.5;
  pVelY[i]  = Math.random() * 2.0 + 0.4;
  pVelZ[i]  = (Math.random() - 0.5) * 1.5;
  pBaseR[i] = r; pBaseG[i] = g; pBaseB[i] = b;
}

const GRAVITY = 3.0; // world units / s²

function updateParticles(dt, state) {
  if (state?.handsData) {
    for (const hand of state.handsData) {
      if (!hand.landmarks || hand.smoothPinch < 0.05) continue;

      const isMagenta = hand.label === 'Left';
      const r = isMagenta ? 1 : 0;
      const g = isMagenta ? 0 : 1;
      const b = 1;
      const br = hand.smoothPinch;

      for (const tipIdx of TIPS) {
        if (Math.random() < hand.smoothPinch * 0.55) {
          const wp = mpToWorld(hand.landmarks[tipIdx]);
          spawnParticle(wp.x, wp.y, wp.z, r * br, g * br, b * br);
        }
      }
    }
  }

  for (let i = 0; i < MAX_P; i++) {
    if (pLife[i] <= 0) {
      geoPos[i * 3 + 2] = -9999;
      geoSize[i] = 0;
      continue;
    }
    pLife[i] -= dt;
    if (pLife[i] <= 0) { geoSize[i] = 0; continue; }

    pVelY[i]   -= GRAVITY * dt;
    pPosX[i]   += pVelX[i] * dt;
    pPosY[i]   += pVelY[i] * dt;
    pPosZ[i]   += pVelZ[i] * dt;

    const t = pLife[i] / 1.5;
    geoPos[i * 3]     = pPosX[i];
    geoPos[i * 3 + 1] = pPosY[i];
    geoPos[i * 3 + 2] = pPosZ[i];
    geoColor[i * 3]   = pBaseR[i] * t;
    geoColor[i * 3+1] = pBaseG[i] * t;
    geoColor[i * 3+2] = pBaseB[i] * t;
    geoSize[i]        = 0.14 * t;
  }

  pGeo.attributes.position.needsUpdate = true;
  pGeo.attributes.aColor.needsUpdate   = true;
  pGeo.attributes.aSize.needsUpdate    = true;
}

// ── Finger orbs + motion trails ───────────────────────────────────────────────
// Slot 0 = MediaPipe "Left" = user's right hand = magenta
// Slot 1 = MediaPipe "Right" = user's left hand = cyan
const ORB_HAND_LABELS  = ['Left', 'Right'];
const ORB_HAND_COLORS  = [{ r:3, g:0, b:3 }, { r:0, g:3, b:3 }]; // HDR values drive bloom

const ORB_RADIUS    = 0.05;
const TRAIL_LEN     = 15;
const VEL_THRESHOLD = 2.0;  // world units/s to trigger flash
const FLASH_DECAY   = 3.0;  // flash intensity lost per second
const FADE_IN_TIME  = 0.1;  // seconds to appear
const FADE_OUT_TIME = 0.2;  // seconds to disappear

// Shared geometry — all 10 orbs use the same shape, different materials
const ORB_GEO = new THREE.SphereGeometry(ORB_RADIUS, 8, 8);

function makeBeamLine(r, g, b) {
  const pos = new Float32Array(6); // 2 vertices × 3 floats
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  const mat = new THREE.LineBasicMaterial({
    color:       new THREE.Color(r, g, b),
    transparent: true,
    opacity:     0,
    blending:    THREE.AdditiveBlending,
    depthWrite:  false,
  });
  const line = new THREE.Line(geo, mat);
  line.visible = false;
  scene.add(line);
  return { line, geo, pos, mat };
}

function makeOrbData(handIdx, tipLandmarkIdx) {
  const { r, g, b } = ORB_HAND_COLORS[handIdx];

  const mat = new THREE.MeshBasicMaterial({
    color:       new THREE.Color(r, g, b),
    transparent: true,
    opacity:     0,
    blending:    THREE.AdditiveBlending,
    depthWrite:  false,
  });
  const mesh = new THREE.Mesh(ORB_GEO, mat);
  mesh.visible = false;
  scene.add(mesh);

  // Trail: THREE.Line with vertex colors (brightness encodes fade)
  const trailPos = new Float32Array(TRAIL_LEN * 3);
  const trailCol = new Float32Array(TRAIL_LEN * 3);
  const trailGeo = new THREE.BufferGeometry();
  trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3).setUsage(THREE.DynamicDrawUsage));
  trailGeo.setAttribute('color',    new THREE.BufferAttribute(trailCol, 3).setUsage(THREE.DynamicDrawUsage));
  const trailLine = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({
    vertexColors: true,
    blending:     THREE.AdditiveBlending,
    depthWrite:   false,
    transparent:  true,
  }));
  trailLine.visible = false;
  scene.add(trailLine);

  const beam = makeBeamLine(r, g, b);

  return {
    mesh, mat,
    trailLine, trailGeo, trailPos, trailCol,
    beam,
    handIdx, tipLandmarkIdx,
    baseR: r, baseG: g, baseB: b,
    currentPos:     new THREE.Vector3(), // reused each frame — no allocation in hot path
    prevPos:        new THREE.Vector3(),
    flashIntensity: 0,
    brightness:     0,                  // 0 = invisible, 1 = full; drives opacity + trail
    posHistory:     [],                 // [{x,y,z}], newest first, max TRAIL_LEN entries
    firstFrame:     true,
  };
}

const fingertipOrbs = [];
for (let h = 0; h < 2; h++) {
  for (const tipIdx of TIPS) {
    fingertipOrbs.push(makeOrbData(h, tipIdx));
  }
}

function updateFingerOrbs(dt, state) {
  const handsData = state?.handsData || [];

  // Index hands by MediaPipe label for O(1) lookup
  const handByLabel = {};
  for (const hand of handsData) handByLabel[hand.label] = hand;

  for (const orb of fingertipOrbs) {
    const hand = handByLabel[ORB_HAND_LABELS[orb.handIdx]] || null;

    if (hand?.landmarks) {
      // ── Active: update position, velocity, flash ────────────────────────────
      const lm = hand.landmarks[orb.tipLandmarkIdx];
      const wp = mpToWorld(lm);
      orb.currentPos.set(wp.x, wp.y, wp.z);

      // Velocity-driven flash (skip on first frame to avoid position-jump spike)
      if (!orb.firstFrame) {
        const vel = orb.prevPos.distanceTo(orb.currentPos) / dt;
        if (vel > VEL_THRESHOLD) {
          orb.flashIntensity = Math.min(1, orb.flashIntensity + (vel - VEL_THRESHOLD) * 0.04);
        }
      }
      orb.prevPos.copy(orb.currentPos);
      orb.firstFrame = false;

      orb.flashIntensity = Math.max(0, orb.flashIntensity - FLASH_DECAY * dt);

      // Orb transform
      orb.mesh.position.copy(orb.currentPos);
      const volScale   = 0.3 + hand.smoothPinch * 1.2;          // 0.3..1.5
      const flashScale = 1 + orb.flashIntensity * 1.5;
      orb.mesh.scale.setScalar(volScale * flashScale);

      // Color: lerp toward white during flash
      const fi = orb.flashIntensity;
      orb.mat.color.setRGB(
        orb.baseR + fi * (1 - orb.baseR),
        orb.baseG + fi * (1 - orb.baseG),
        orb.baseB + fi * (1 - orb.baseB),
      );

      // Fade in
      orb.brightness    = Math.min(1, orb.brightness + dt / FADE_IN_TIME);
      orb.mat.opacity   = orb.brightness;
      orb.mesh.visible  = true;

      // Append to trail history (newest at front)
      orb.posHistory.unshift({ x: orb.currentPos.x, y: orb.currentPos.y, z: orb.currentPos.z });
      if (orb.posHistory.length > TRAIL_LEN) orb.posHistory.pop();

    } else {
      // ── Inactive: fade out ──────────────────────────────────────────────────
      orb.brightness  = Math.max(0, orb.brightness - dt / FADE_OUT_TIME);
      orb.mat.opacity = orb.brightness;
      if (orb.brightness <= 0) {
        orb.mesh.visible = false;
        orb.posHistory   = [];
      }
      orb.flashIntensity = Math.max(0, orb.flashIntensity - FLASH_DECAY * dt);
      orb.firstFrame = true;
    }

    // ── Trail geometry update (runs whether or not hand is active) ────────────
    const count = orb.posHistory.length;
    if (count >= 2) {
      for (let i = 0; i < TRAIL_LEN; i++) {
        if (i < count) {
          const p = orb.posHistory[i];
          orb.trailPos[i * 3]     = p.x;
          orb.trailPos[i * 3 + 1] = p.y;
          orb.trailPos[i * 3 + 2] = p.z;
          // Newest vertex (i=0) = full brightness × orb.brightness; oldest = 0
          const t = (1 - i / (TRAIL_LEN - 1)) * orb.brightness;
          orb.trailCol[i * 3]     = orb.baseR * t;
          orb.trailCol[i * 3 + 1] = orb.baseG * t;
          orb.trailCol[i * 3 + 2] = orb.baseB * t;
        } else {
          // Pad tail with last position, black color so it doesn't draw visibly
          const last = orb.posHistory[count - 1];
          orb.trailPos[i * 3]     = last.x;
          orb.trailPos[i * 3 + 1] = last.y;
          orb.trailPos[i * 3 + 2] = last.z;
          orb.trailCol[i * 3]     = 0;
          orb.trailCol[i * 3 + 1] = 0;
          orb.trailCol[i * 3 + 2] = 0;
        }
      }
      orb.trailGeo.setDrawRange(0, count);
      orb.trailGeo.attributes.position.needsUpdate = true;
      orb.trailGeo.attributes.color.needsUpdate    = true;
      orb.trailLine.visible = orb.brightness > 0;
    } else {
      orb.trailLine.visible = false;
    }

    // ── Beam from fingertip to icosahedron center ─────────────────────────────
    if (orb.brightness > 0) {
      orb.beam.pos[0] = orb.currentPos.x;
      orb.beam.pos[1] = orb.currentPos.y;
      orb.beam.pos[2] = orb.currentPos.z;
      orb.beam.pos[3] = icoMesh.position.x;
      orb.beam.pos[4] = icoMesh.position.y;
      orb.beam.pos[5] = icoMesh.position.z;
      orb.beam.geo.attributes.position.needsUpdate = true;
      orb.beam.mat.opacity = orb.brightness * 0.5;
      orb.beam.line.visible = true;
    } else {
      orb.beam.line.visible = false;
    }
  }
}

// ── Animation loop ────────────────────────────────────────────────────────────
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const dt    = Math.min(clock.getDelta(), 0.05);
  const state = window.synthState;

  let fftData = null;
  try {
    if (state?.analyserNode) fftData = state.analyserNode.getValue();
  } catch (_) { /* analyser not ready yet */ }

  updateIco(fftData, state);
  updateParticles(dt, state);
  updateFingerOrbs(dt, state);

  composer.render();
}

animate();
