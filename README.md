# Hand Synth

A browser-based synthesizer you control with your hands via webcam.

**Live demo:** https://gmillycodz.github.io/Hand-synth/

## How to use

1. Open the link in Chrome (requires HTTPS and webcam access)
2. Allow camera when prompted
3. Click the screen to start audio
4. Move your hands

## Controls

| Gesture | Effect |
|---|---|
| Pinch (thumb + index) | Volume |
| Hand X position | Pitch — pentatonic scale |
| Hand Y position | Filter cutoff |
| Hand tilt | Waveform morph (sine to sawtooth) |

Two hands work independently: right hand plays the lead voice, left hand plays bass.

Press `C` to toggle the webcam feed, `H` to toggle hand landmarks.

## Stack

Vanilla JS, MediaPipe Hands, Tone.js, Three.js. No build step, no bundler — everything loads from CDN.

## Credits

Built collaboratively with [Claude](https://claude.ai).
