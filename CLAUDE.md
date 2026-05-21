# Hand Synth

A browser-based hand-controlled music synthesizer. Hand gestures control sound and visuals in real time using your webcam.

## Stack

| Layer           | Library                                                         | Status            |
| --------------- | --------------------------------------------------------------- | ----------------- |
| Hand tracking   | MediaPipe Hands (`@mediapipe/hands`, `@mediapipe/camera_utils`) | ✅ Slice A        |
| Audio synthesis | Tone.js                                                         | Planned — Slice B |
| 3D visuals      | Three.js                                                        | Planned — Slice C |

Everything is loaded from CDN. No build step, no bundler, no npm.

## Constraint: Single File

All code lives in `index.html` for now. We'll evaluate splitting into separate `.js` files only when adding Tone.js or Three.js makes the single file unmanageable — and even then, no build step.

## Run Instructions

**Do not open `index.html` directly as a `file://` URL.** Browsers block webcam access on file URLs and MediaPipe's WASM assets won't load correctly.

### Option 1 — VS Code Live Server (recommended)

1. Install the [Live Server extension](https://marketplace.visualstudio.com/items?itemName=ritwickdey.LiveServer)
2. Open the `Hand synth/` folder in VS Code
3. Right-click `index.html` → **Open with Live Server**
4. Allow camera access when the browser prompts

### Option 2 — Python

```bash
cd "Hand synth"
python3 -m http.server 8080
# open http://localhost:8080
```

### Option 3 — Node (npx serve)

```bash
npx serve "Hand synth"
```

## Slices

- **Slice A** ✅ Hand tracking — MediaPipe webcam feed + 21-landmark overlay, FPS counter
- **Slice B** — Audio — Tone.js synthesis driven by hand position / gesture
- **Slice C** — Visuals — Three.js scene reacting to hand data

## Hand Landmark Reference

MediaPipe returns 21 landmarks per hand (0 = wrist, 4/8/12/16/20 = fingertips). Coordinates are normalized 0–1; x is flipped in canvas drawing to match the mirrored video.

Colors: **cyan** = user's left hand, **magenta** = user's right hand.
