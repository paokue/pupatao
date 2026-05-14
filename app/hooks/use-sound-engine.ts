
import { useRef, useCallback, useEffect } from 'react'

// All sounds are synthesized via Web Audio API — no external files required.
// This keeps the bundle tiny and works offline.

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!(window as any)._audioCtx) {
    try {
      (window as any)._audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)()
    } catch {
      return null
    }
  }
  return (window as any)._audioCtx as AudioContext
}

function resumeCtx(ctx: AudioContext) {
  if (ctx.state === 'suspended') ctx.resume()
}

// ── Primitive builders ────────────────────────────────────────────────────────

function playTone(
  ctx: AudioContext,
  freq: number,
  type: OscillatorType,
  startTime: number,
  duration: number,
  gainPeak: number,
  dest?: AudioNode,
) {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, startTime)
  gain.gain.setValueAtTime(0, startTime)
  gain.gain.linearRampToValueAtTime(gainPeak, startTime + 0.01)
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration)
  osc.connect(gain)
  gain.connect(dest ?? ctx.destination)
  osc.start(startTime)
  osc.stop(startTime + duration + 0.01)
}

function playNoise(ctx: AudioContext, startTime: number, duration: number, gainPeak: number, dest?: AudioNode) {
  const bufSize = ctx.sampleRate * duration
  const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1
  const src = ctx.createBufferSource()
  src.buffer = buf
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(gainPeak, startTime)
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration)
  const filter = ctx.createBiquadFilter()
  filter.type = 'bandpass'
  filter.frequency.value = 1200
  src.connect(filter)
  filter.connect(gain)
  gain.connect(dest ?? ctx.destination)
  src.start(startTime)
  src.stop(startTime + duration + 0.01)
}

// ── Individual sound effects ──────────────────────────────────────────────────

export function playClick() {
  const ctx = getCtx()
  if (!ctx) return
  resumeCtx(ctx)
  const t = ctx.currentTime
  playTone(ctx, 880, 'sine', t, 0.06, 0.25)
  playTone(ctx, 1320, 'sine', t + 0.01, 0.04, 0.12)
}

export function playChipPlace() {
  const ctx = getCtx()
  if (!ctx) return
  resumeCtx(ctx)
  const t = ctx.currentTime
  playNoise(ctx, t, 0.08, 0.35)
  playTone(ctx, 600, 'sine', t, 0.1, 0.15)
}

// Bright coin clink — used when selecting chip denominations
export function playCoin() {
  const ctx = getCtx()
  if (!ctx) return
  resumeCtx(ctx)
  const t = ctx.currentTime
  // Two quick metallic pings
  playTone(ctx, 1800, 'sine', t, 0.12, 0.45)
  playTone(ctx, 2400, 'sine', t + 0.03, 0.09, 0.3)
  playTone(ctx, 1200, 'triangle', t + 0.01, 0.1, 0.2)
  playNoise(ctx, t, 0.04, 0.12)
}

export function playRollTick() {
  const ctx = getCtx()
  if (!ctx) return
  resumeCtx(ctx)
  const t = ctx.currentTime
  playNoise(ctx, t, 0.04, 0.2)
  playTone(ctx, 400, 'square', t, 0.04, 0.08)
}

export function playWin() {
  const ctx = getCtx()
  if (!ctx) return
  resumeCtx(ctx)
  const t = ctx.currentTime
  // Ascending fanfare
  const notes = [523, 659, 784, 1047]
  notes.forEach((freq, i) => {
    playTone(ctx, freq, 'sine', t + i * 0.12, 0.25, 0.4)
    playTone(ctx, freq * 1.5, 'sine', t + i * 0.12 + 0.05, 0.18, 0.15)
  })
  // Sparkle noise bursts
  for (let i = 0; i < 3; i++) {
    playNoise(ctx, t + i * 0.15, 0.05, 0.1)
  }
}

export function playLose() {
  const ctx = getCtx()
  if (!ctx) return
  resumeCtx(ctx)
  const t = ctx.currentTime
  // Descending sad tones
  const notes = [392, 349, 311, 262]
  notes.forEach((freq, i) => {
    playTone(ctx, freq, 'triangle', t + i * 0.15, 0.3, 0.25)
  })
}

// ── Background music engine ───────────────────────────────────────────────────
// Uses an HTMLAudioElement playing the bundled MPEG file so the admin can
// swap the track by replacing /sounds/background-sound.mpeg without any
// code changes.

let bgAudio: HTMLAudioElement | null = null

function getBgAudio(): HTMLAudioElement | null {
  if (typeof window === 'undefined') return null
  if (!bgAudio) {
    bgAudio = new Audio('/sounds/background-sound.mpeg')
    bgAudio.loop = true
    bgAudio.volume = 0.3
  }
  return bgAudio
}

export function startBgMusic(volumeFraction = 0.3) {
  const audio = getBgAudio()
  if (!audio || !audio.paused) return
  audio.volume = volumeFraction
  audio.play().catch(() => { /* autoplay blocked — user must interact first */ })
}

export function stopBgMusic() {
  const audio = getBgAudio()
  if (!audio || audio.paused) return
  audio.pause()
  audio.currentTime = 0
}

// Pause BGM when the PWA is backgrounded / screen is locked, resume on return.
// Called once at app startup — safe to call multiple times (guard prevents dups).
let visibilityHandlerAttached = false
export function attachBgMusicVisibilityGuard() {
  if (typeof document === 'undefined' || visibilityHandlerAttached) return
  visibilityHandlerAttached = true
  document.addEventListener('visibilitychange', () => {
    const audio = getBgAudio()
    if (!audio) return
    if (document.hidden) {
      // App went to background — pause without resetting position.
      if (!audio.paused) audio.pause()
    } else {
      // App came back to foreground — resume only if it was playing before.
      if (audio.paused && audio.currentTime > 0) {
        audio.play().catch(() => {})
      }
    }
  })
}

export function setBgVolume(v: number) {
  const audio = getBgAudio()
  if (audio) audio.volume = v
}

// ── React hook ────────────────────────────────────────────────────────────────

export function useSoundEngine() {
  // Use an explicit number ref so window.clearInterval always gets the correct type.
  const rollTickRef = useRef<number | null>(null)

  const startRollSound = useCallback(() => {
    // Clear any previously leaked interval before starting a new one.
    if (rollTickRef.current !== null) window.clearInterval(rollTickRef.current)
    rollTickRef.current = window.setInterval(playRollTick, 80)
  }, [])

  const stopRollSound = useCallback(() => {
    if (rollTickRef.current !== null) {
      window.clearInterval(rollTickRef.current)
      rollTickRef.current = null
    }
  }, [])

  useEffect(() => {
    return () => {
      if (rollTickRef.current !== null) window.clearInterval(rollTickRef.current)
    }
  }, [])

  return { startRollSound, stopRollSound, playClick, playChipPlace, playCoin, playWin, playLose, startBgMusic, stopBgMusic }
}
