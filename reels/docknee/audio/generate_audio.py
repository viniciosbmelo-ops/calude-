#!/usr/bin/env python3
"""
DocKnee Reel v2 - original procedural soundtrack + SFX.

Everything here is synthesized from scratch (numpy/scipy): no samples, no
third-party music. Timeline (scene cuts, text pops, risers, impacts) is read
from ../src/timeline.json, the same file the Remotion composition uses, so the
music grid and the picture are locked together.

  120 BPM @ 30 fps -> 1 beat = 15 frames = 0.5 s, 1 bar = 60 frames = 2 s.
  The track opens with a 2-beat pickup; downbeats fall on frame 30 + 60k.

Outputs (48 kHz, stereo, 24-bit WAV):
  ../public/audio/docknee-music.wav   music stem
  ../public/audio/docknee-sfx.wav     SFX stem (whooshes, pops, risers, impacts, ding)
  ./docknee-mix.wav                   reference mix (music + sfx)

Both stems share one gain + limiter curve, so music + sfx summed in Remotion
equals the reference mix, normalized to about -14 LUFS integrated with true
peak below -1 dBTP (measured with ffmpeg ebur128).

Usage: python3 generate_audio.py   (needs numpy, scipy, ffmpeg on PATH)
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
import wave
from pathlib import Path

import numpy as np
from scipy import signal
from scipy.ndimage import maximum_filter1d

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
TL = json.loads((ROOT / "src" / "timeline.json").read_text())

SR = 48000
FPS = TL["fps"]
BPM = TL["bpm"]
FPB = TL["framesPerBeat"]
FIRST_DOWNBEAT = TL["firstDownbeat"]
TOTAL_FRAMES = TL["totalFrames"]
N = TOTAL_FRAMES * SR // FPS  # 2_880_000 samples = 60.0 s
assert BPM * FPB == 60 * FPS, "BPM and frames-per-beat disagree"

TARGET_LUFS = -14.0
CEILING_DBTP = -1.6

rng = np.random.default_rng(20261103)


# ----------------------------------------------------------------------------
# Time helpers
# ----------------------------------------------------------------------------
def fr2s(frame: float) -> int:
    return int(round(frame * SR / FPS))


def beat2s(beat: float) -> int:
    """Beat index -> sample. beat 0 = first downbeat (frame 30)."""
    return fr2s(FIRST_DOWNBEAT + FPB * beat)


def bar2s(bar: float) -> int:
    return beat2s(bar * 4)


BEAT = beat2s(1) - beat2s(0)  # 24000 samples


def midi2hz(m: float) -> float:
    return 440.0 * 2 ** ((m - 69) / 12)


def stereo(x: np.ndarray, pan: float = 0.0) -> np.ndarray:
    """Equal-power pan, pan in [-1, 1]."""
    a = (pan + 1) * np.pi / 4
    return np.stack([x * np.cos(a), x * np.sin(a)], axis=1)


def add(bus: np.ndarray, x: np.ndarray, start: int) -> None:
    """Mix x (mono or stereo) into bus at sample offset `start` (clipped to range)."""
    if x.ndim == 1:
        x = stereo(x)
    s0 = max(start, 0)
    off = s0 - start
    e = min(start + len(x), len(bus))
    if e > s0:
        bus[s0:e] += x[off : off + (e - s0)]


def env_adsr(n: int, a: float, d: float, s: float, r: float, gate: float) -> np.ndarray:
    """ADSR envelope of length n samples; gate (seconds) = note-on length."""
    t = np.arange(n) / SR
    e = np.where(
        t < a,
        t / max(a, 1e-6),
        s + (1 - s) * np.exp(-(t - a) / max(d, 1e-6)),
    )
    g = t >= gate
    if np.any(g):
        level_at_gate = e[np.argmax(g)] if np.argmax(g) > 0 else e[0]
        e[g] = level_at_gate * np.exp(-(t[g] - gate) / max(r, 1e-6))
    return e


# ----------------------------------------------------------------------------
# Oscillators and filters
# ----------------------------------------------------------------------------
def polyblep_saw(freq: float | np.ndarray, n: int, phase0: float = 0.0) -> np.ndarray:
    f = np.broadcast_to(np.asarray(freq, dtype=np.float64), (n,))
    dt = f / SR
    phase = (phase0 + np.cumsum(dt)) % 1.0
    y = 2.0 * phase - 1.0
    # PolyBLEP correction around the discontinuity
    m1 = phase < dt
    t1 = phase[m1] / dt[m1]
    y[m1] -= t1 + t1 - t1 * t1 - 1.0
    m2 = phase > 1.0 - dt
    t2 = (phase[m2] - 1.0) / dt[m2]
    y[m2] -= t2 * t2 + t2 + t2 + 1.0
    return y


def sine(freq: float | np.ndarray, n: int, phase0: float = 0.0) -> np.ndarray:
    f = np.broadcast_to(np.asarray(freq, dtype=np.float64), (n,))
    return np.sin(2 * np.pi * (phase0 + np.cumsum(f) / SR))


def noise(n: int) -> np.ndarray:
    return rng.standard_normal(n)


def filt(x: np.ndarray, fc, btype: str = "low", order: int = 2) -> np.ndarray:
    sos = signal.butter(order, np.asarray(fc) / (SR / 2), btype=btype, output="sos")
    return signal.sosfilt(sos, x, axis=0)


def tv_filter(x: np.ndarray, fc: np.ndarray, btype: str = "low", block: int = 256, bw: float = 1.6) -> np.ndarray:
    """Time-varying 2nd-order Butterworth (block-wise coefficient update, state carried)."""
    x2 = x if x.ndim == 2 else x[:, None]
    out = np.zeros_like(x2)
    zi = None
    nyq = SR / 2
    for s0 in range(0, len(x2), block):
        e = min(s0 + block, len(x2))
        c = float(np.clip(fc[min(s0 + block // 2, len(fc) - 1)], 25, nyq * 0.45))
        if btype == "band":
            wn = [max(c / bw, 20) / nyq, min(c * bw, nyq * 0.95) / nyq]
            sos = signal.butter(1, wn, btype="bandpass", output="sos")
        else:
            sos = signal.butter(2, c / nyq, btype=btype, output="sos")
        if zi is None:
            zi = np.zeros((sos.shape[0], 2, x2.shape[1]))
        out[s0:e], zi = signal.sosfilt(sos, x2[s0:e], axis=0, zi=zi)
    return out if x.ndim == 2 else out[:, 0]


def soft_clip(x: np.ndarray, drive: float = 1.0) -> np.ndarray:
    return np.tanh(x * drive) / np.tanh(drive)


def curve(points: list[tuple[float, float]], log: bool = True) -> np.ndarray:
    """Piecewise curve over the whole timeline. points = [(frame, value), ...]."""
    xs = np.array([fr2s(p[0]) for p in points], dtype=np.float64)
    ys = np.array([p[1] for p in points], dtype=np.float64)
    t = np.arange(N, dtype=np.float64)
    if log:
        return np.exp(np.interp(t, xs, np.log(ys)))
    return np.interp(t, xs, ys)


# ----------------------------------------------------------------------------
# Effects
# ----------------------------------------------------------------------------
def make_ir(seconds: float = 2.2, rt60: float = 1.7, predelay: float = 0.018) -> np.ndarray:
    n = int(seconds * SR)
    t = np.arange(n) / SR
    decay = np.exp(-6.91 * t / rt60)
    ir = np.stack([noise(n), noise(n)], axis=1) * decay[:, None]
    # darker tail: progressively low-passed (mix of bright early / dark late)
    dark = filt(ir, 2500, "low")
    w = np.clip(t / 0.4, 0, 1)[:, None]
    ir = ir * (1 - w) + dark * w
    ir = filt(ir, 180, "high")
    pd = np.zeros((int(predelay * SR), 2))
    ir = np.concatenate([pd, ir])
    return ir / np.sqrt(np.sum(ir**2) / 2)


IR = make_ir()


def reverb(x: np.ndarray) -> np.ndarray:
    wet = np.stack([signal.fftconvolve(x[:, ch], IR[:, ch])[: len(x)] for ch in range(2)], axis=1)
    return wet


def pingpong(x: np.ndarray, delay_s: float, fb: float = 0.42, taps: int = 7) -> np.ndarray:
    """Ping-pong delay (wet only), each repeat a bit darker."""
    d = int(delay_s * SR)
    mono = x.mean(axis=1)
    out = np.zeros_like(x)
    tap = mono
    for k in range(1, taps + 1):
        tap = filt(tap, 5000 - 450 * k, "low", order=1)
        g = fb**k
        ch = (k - 1) % 2  # alternate L/R
        if k * d < len(x):
            out[k * d :, ch] += g * tap[: len(x) - k * d]
    return out


def sidechain(kick_samples: list[int], depth: float, release: float = 0.16) -> np.ndarray:
    g = np.ones(N)
    n = int(release * 5 * SR)
    t = np.arange(n) / SR
    a = int(0.004 * SR)  # 4 ms attack so the duck itself does not click
    shape = 1 - depth * np.exp(-t / release)
    shape[:a] = np.linspace(1, shape[a], a)
    for s in kick_samples:
        e = min(s + n, N)
        if s < 0 or s >= N:
            continue
        g[s:e] = np.minimum(g[s:e], shape[: e - s])
    return g


# ----------------------------------------------------------------------------
# Drum voices
# ----------------------------------------------------------------------------
def kick(vel: float = 1.0) -> np.ndarray:
    n = int(0.5 * SR)
    t = np.arange(n) / SR
    f = 48 + 110 * np.exp(-t / 0.035) + 40 * np.exp(-t / 0.006)
    body = sine(f, n) * np.exp(-t / 0.28)
    click = filt(noise(n), 3000, "high") * np.exp(-t / 0.004) * 0.35
    return soft_clip((body + click) * vel, 1.6) * 0.95


def clap(vel: float = 1.0) -> np.ndarray:
    n = int(0.35 * SR)
    t = np.arange(n) / SR
    nz = filt(noise(n), [900, 3200], "bandpass")
    e = np.zeros(n)
    for k, off in enumerate([0.0, 0.009, 0.019, 0.03]):
        tt = t - off
        e += np.where(tt >= 0, np.exp(-np.clip(tt, 0, None) / (0.006 if k < 3 else 0.11)), 0)
    return nz * e * vel * 1.6


def snare(vel: float = 1.0) -> np.ndarray:
    n = int(0.25 * SR)
    t = np.arange(n) / SR
    tone = sine(185 * (1 + 0.5 * np.exp(-t / 0.01)), n) * np.exp(-t / 0.05)
    nz = filt(noise(n), [1200, 9000], "bandpass") * np.exp(-t / 0.07)
    return (tone * 0.5 + nz) * vel


def hat(vel: float = 1.0, open_: bool = False) -> np.ndarray:
    dur = 0.32 if open_ else 0.06
    n = int(dur * SR)
    t = np.arange(n) / SR
    nz = filt(noise(n), 7500, "high", order=2)
    # metallic edge: a few square-ish partials
    metal = sum(np.sign(np.sin(2 * np.pi * f * t)) for f in (3140, 4270, 5650, 7020)) * 0.06
    e = np.exp(-t / (0.12 if open_ else 0.018))
    return (nz + filt(metal, 6000, "high")) * e * vel


def crash(vel: float = 1.0, dur: float = 2.2) -> np.ndarray:
    n = int(dur * SR)
    t = np.arange(n) / SR
    nz = filt(noise(n), 3500, "high")
    shimmer = filt(noise(n), [6000, 12000], "bandpass")
    e = np.exp(-t / 0.7) * np.clip(t / 0.002, 0, 1)
    return (nz * 0.7 + shimmer * 0.5) * e * vel


# ----------------------------------------------------------------------------
# Tonal voices
# ----------------------------------------------------------------------------
# D major: vi - IV - I - V  (Bm - G - D - A), one chord per bar.
CHORDS = {
    "Bm": {"bass": 35, "pad": [59, 62, 66, 69]},
    "G": {"bass": 31, "pad": [55, 59, 62, 66]},
    "D": {"bass": 38, "pad": [57, 62, 66, 69]},
    "A": {"bass": 33, "pad": [57, 61, 64, 69]},
}
PROG = ["Bm", "G", "D", "A"]
LAST_BAR = 29  # final hit (frame 1770)


def chord_for(bar: int) -> str:
    if bar >= LAST_BAR:
        return "D"
    return PROG[(bar - 1) % 4]


def pad_note(m: int, n: int, gate: float) -> np.ndarray:
    f0 = midi2hz(m)
    out = np.zeros((n, 2))
    for det, pan in ((-9, -0.8), (0, 0.0), (8, 0.8), (-4, -0.35), (4, 0.35)):
        f = f0 * 2 ** (det / 1200)
        v = polyblep_saw(f, n, rng.random())
        out += stereo(v, pan) * 0.22
    e = env_adsr(n, 0.18, 0.6, 0.75, 0.45, gate)
    return out * e[:, None]


def bass_note(m: int, n: int, gate: float) -> np.ndarray:
    f = midi2hz(m)
    sub = sine(f, n)
    saw = polyblep_saw(f * 2 ** (3 / 1200), n) * 0.55
    x = sub + filt(saw, 900, "low")
    e = env_adsr(n, 0.004, 0.12, 0.65, 0.05, gate)
    return soft_clip(x * e, 1.3)


def pluck(m: int, n: int, bright: float = 1.0) -> np.ndarray:
    f = midi2hz(m)
    t = np.arange(n) / SR
    y = np.zeros(n)
    for h in range(1, 9):
        if f * h > 14000:
            break
        y += (1 / h) * np.sin(2 * np.pi * f * h * t + rng.random() * 0.3) * np.exp(-t * (6 + 9 * h / bright))
    y *= np.clip(t / 0.002, 0, 1)
    return y


def bell(m: int, n: int) -> np.ndarray:
    """Soft FM bell for the lead / logo ding."""
    f = midi2hz(m)
    t = np.arange(n) / SR
    index = 2.4 * np.exp(-t / 0.18) + 0.3
    mod = np.sin(2 * np.pi * f * 2.0 * t)
    car = np.sin(2 * np.pi * f * t + index * mod)
    partial = 0.25 * np.sin(2 * np.pi * f * 4.07 * t) * np.exp(-t / 0.25)
    e = np.exp(-t / 0.65) * np.clip(t / 0.003, 0, 1)
    return (car + partial) * e


# ----------------------------------------------------------------------------
# Arrangement
# ----------------------------------------------------------------------------
def section(bar: int) -> str:
    if bar < 0:
        return "pickup"
    if bar == 0:
        return "hook"
    if bar in (1, 2):
        return "problem"
    if 3 <= bar <= 11:
        return "grooveA"
    if 12 <= bar <= 19:
        return "grooveB"
    if 20 <= bar <= 23:
        return "grooveA"
    if bar in (24, 25):
        return "cred"
    if bar == 26:
        return "build"
    if bar in (27, 28):
        return "cta"
    return "end"


def build_music() -> np.ndarray:
    drums = np.zeros((N, 2))
    bass = np.zeros((N, 2))
    pad = np.zeros((N, 2))
    arp = np.zeros((N, 2))
    lead = np.zeros((N, 2))
    verb_send = np.zeros((N, 2))
    kicks: list[int] = []

    for bar in range(-1, LAST_BAR + 1):
        sec = section(bar)
        b0 = bar * 4

        # ---------------- drums ----------------
        if sec in ("hook", "grooveA", "grooveB", "cta", "build"):
            kick_beats = [0, 1, 2, 3]
        elif sec == "problem":
            kick_beats = [0] if bar == 1 else [0, 2]
        elif sec == "cred":
            kick_beats = [0, 2.5] if bar == 24 else [0, 2.5, 3.5]
        elif sec == "end":
            kick_beats = [0]
        else:
            kick_beats = []
        for kb in kick_beats:
            s = beat2s(b0 + kb)
            add(drums, kick(1.0 if kb == int(kb) else 0.8), s)
            kicks.append(s)

        if sec in ("hook", "grooveA", "grooveB", "cta"):
            for cb in (1, 3):
                c = stereo(clap(0.9), 0.05)
                add(drums, c, beat2s(b0 + cb))
                add(verb_send, c * 0.5, beat2s(b0 + cb))
        if sec == "cred":
            c = stereo(clap(0.75), 0.0)
            add(drums, c, beat2s(b0 + 2))
            add(verb_send, c * 0.8, beat2s(b0 + 2))

        # hats
        if sec in ("grooveA", "grooveB", "cta", "hook", "cred", "build", "problem"):
            for i in range(16):
                pos = b0 + i / 4
                if sec in ("hook", "cred") and i % 2 == 1:
                    continue
                v = 0.55 if i % 4 == 2 else (0.32 if i % 2 == 0 else 0.22)
                if sec == "problem":
                    v *= 0.55
                is_open = sec in ("grooveB", "cta") and i % 4 == 2
                add(drums, stereo(hat(v, is_open), 0.3 if i % 2 else 0.18), beat2s(pos))
        if sec == "pickup":
            # 2-beat pickup: rising snare 8ths -> 16ths into the first downbeat
            for i, pos in enumerate([-2, -1.5, -1, -0.75, -0.5, -0.25]):
                v = 0.25 + 0.12 * i
                sn = stereo(snare(v), 0.0)
                add(drums, sn, beat2s(pos))
                add(verb_send, sn * 0.4, beat2s(pos))

        # snare build (bar 2 -> drop, bar 26 -> CTA). Leave the last 8th empty.
        if (sec == "problem" and bar == 2) or sec == "build":
            positions = [0, 0.5, 1, 1.5] + [2 + k / 4 for k in range(6)]
            for k, p in enumerate(positions):
                v = 0.25 + 0.6 * k / len(positions)
                sn = stereo(snare(v), 0.0)
                add(drums, sn, beat2s(b0 + p))
                add(verb_send, sn * 0.35, beat2s(b0 + p))
        # fills every 4 bars inside the grooves
        if sec in ("grooveA", "grooveB") and bar % 4 == 2 and bar not in (3,):
            for k, p in enumerate([3.25, 3.5, 3.75]):
                add(drums, stereo(snare(0.35 + 0.15 * k), 0.0), beat2s(b0 + p))
        # crashes on section starts
        if bar in (0, 3, 12, 20, 27, LAST_BAR):
            cr = stereo(crash(0.55 if bar != LAST_BAR else 0.7), 0.0)
            add(drums, cr, beat2s(b0))
            add(verb_send, cr * 0.3, beat2s(b0))

        # ---------------- tonal ----------------
        if bar < 0:
            continue
        ch = CHORDS[chord_for(bar)]
        bar_len = BEAT * 4
        s_bar = bar2s(bar)

        # Pad: whole bar (final hit rings out to the end)
        gate = bar_len / SR if bar < LAST_BAR else 0.6
        n_pad = bar_len + int(0.9 * SR)
        for m in ch["pad"]:
            p = pad_note(m, n_pad, gate)
            add(pad, p, s_bar)

        # Bass
        root = ch["bass"]
        if sec in ("hook", "grooveA", "grooveB", "cta", "build", "problem"):
            pattern = [0, 0, 12, 0, 0, 0, 12, 7]
            for i, iv in enumerate(pattern):
                n = int(0.32 * SR)
                note = bass_note(root + 12 + iv if sec != "problem" else root + 12, n, 0.2)
                vel = 0.75 if i % 2 == 0 else 1.0  # off-beat push
                add(bass, note * vel, beat2s(bar * 4 + i / 2))
        elif sec == "cred":
            add(bass, bass_note(root + 12, bar_len, bar_len / SR - 0.05) * 0.8, s_bar)
        elif sec == "end":
            add(bass, bass_note(root + 12, int(1.0 * SR), 0.35), s_bar)

        # Arp pluck (16ths), ascending chord tones over two octaves
        if sec in ("hook", "grooveA", "grooveB", "cta", "build", "problem", "cred"):
            tones = [m + 12 for m in ch["pad"]] + [m + 24 for m in ch["pad"]]
            patt = [0, 1, 2, 3, 1, 2, 3, 4, 2, 3, 4, 5, 3, 4, 5, 6]
            lvl = {"hook": 0.8, "grooveA": 1.0, "grooveB": 0.7, "cta": 1.0, "build": 0.9, "problem": 0.55, "cred": 0.75}[sec]
            for i, pi in enumerate(patt):
                if sec == "cred" and i % 2 == 1:
                    continue
                v = lvl * (1.0 if i % 4 == 0 else 0.7)
                n = int(0.45 * SR)
                add(arp, stereo(pluck(tones[pi], n, 1.4 if sec != "problem" else 0.6) * v, -0.25 + 0.5 * (i % 2)), beat2s(bar * 4 + i / 4))

        # Lead bell melody (groove B and CTA): 8th-note grid, (pos, midi, len)
        if sec in ("grooveB", "cta"):
            MEL = {
                "Bm": [(0, 78, 1.0), (1.5, 74, 0.5), (2, 76, 0.5), (2.5, 78, 1.5)],
                "G": [(0, 74, 1.0), (1, 71, 1.0), (2, 74, 2.0)],
                "D": [(0, 81, 1.0), (1, 78, 1.0), (2, 76, 0.5), (2.5, 74, 1.5)],
                "A": [(0, 76, 1.0), (1, 73, 1.0), (2, 76, 1.0), (3, 81, 1.0)],
            }
            for pos, m, ln in MEL[chord_for(bar)]:
                n = int((ln * 0.5 + 0.8) * SR)
                b = bell(m, n) * 0.5
                add(lead, stereo(b, 0.1), beat2s(bar * 4 + pos))
                add(verb_send, stereo(b, 0.1) * 0.6, beat2s(bar * 4 + pos))

    # ---------------- processing ----------------
    # Filter automation (frames): problem section closes, sweeps open into the drop,
    # opens fully for the grooves, relaxes on credibility, sweeps into the CTA.
    pad_fc = curve([(0, 900), (30, 2600), (88, 2600), (96, 700), (150, 900), (209, 6000), (212, 3200),
                    (1440, 3200), (1500, 1800), (1590, 1600), (1649, 6000), (1652, 3600), (1800, 2200)])
    arp_fc = curve([(0, 1200), (30, 4000), (88, 4000), (96, 1100), (150, 1300), (209, 9000), (212, 6500),
                    (1440, 6500), (1500, 3500), (1590, 3000), (1649, 10000), (1652, 7000), (1800, 4000)])
    bass_fc = curve([(0, 600), (30, 1600), (88, 1600), (96, 260), (150, 300), (209, 2400), (212, 1500),
                     (1800, 1500)])
    pad = tv_filter(pad, pad_fc, "low")
    pad = filt(pad, 160, "high")
    arp = tv_filter(arp, arp_fc, "low")
    bass = tv_filter(bass, bass_fc, "low")

    # Sidechain-style ducking from every kick
    sc_pad = sidechain(kicks, 0.65, 0.15)
    sc_bass = sidechain(kicks, 0.55, 0.09)
    sc_arp = sidechain(kicks, 0.3, 0.1)
    pad *= sc_pad[:, None]
    bass *= sc_bass[:, None]

    arp_wet = pingpong(arp, 0.375, 0.38)
    arp = (arp + arp_wet * 0.45) * sc_arp[:, None]
    verb_send += arp * 0.35 + pad * 0.25 + lead * 0.2

    music = (
        drums * 0.85
        + bass * 0.48
        + pad * 0.55
        + arp * 0.20
        + lead * 0.16
        + reverb(verb_send) * 0.13
    )
    music = filt(music, 28, "high")

    # Gap: last 8th before the drop and before the CTA is silent (impact contrast).
    gate = np.ones(N)
    for cut in (210, 1650):
        s1 = fr2s(cut - FPB / 2)
        s2 = fr2s(cut)
        f = int(0.006 * SR)
        gate[s1 : s2] = 0.0
        gate[s1 - f : s1] = np.linspace(1, 0, f)
    music *= gate[:, None]

    # Clean ending: final hit at frame 1770 rings out, smooth fade over the last 0.45 s.
    fade = np.ones(N)
    fs = fr2s(TOTAL_FRAMES) - int(0.45 * SR)
    fade[fs:] = np.cos(np.linspace(0, np.pi / 2, N - fs)) ** 2
    music *= fade[:, None]
    return music


# ----------------------------------------------------------------------------
# SFX
# ----------------------------------------------------------------------------
def whoosh(kind: str, pre: float = 0.32, post: float = 0.28) -> tuple[np.ndarray, int]:
    """Filtered-noise sweep peaking on the cut. Returns (stereo, samples before peak)."""
    n_pre, n_post = int(pre * SR), int(post * SR)
    n = n_pre + n_post
    t = np.arange(n) / SR
    tp = pre
    lo, hi = {"whip": (500, 6500), "zoomThrough": (180, 3200), "barWipe": (350, 5200),
              "chevron": (300, 4600), "iris": (200, 3800)}[kind]
    fc = np.where(t < tp, lo * (hi / lo) ** ((t / tp) ** 1.6), hi * (lo * 1.6 / hi) ** ((t - tp) / (n_post / SR)))
    x = tv_filter(noise(n), fc, "band", block=128, bw=1.5)
    amp = np.where(t < tp, (t / tp) ** 2.4, np.exp(-(t - tp) / 0.07))
    x = x * amp
    if kind == "zoomThrough":
        body = sine(70 + 60 * np.clip(t / tp, 0, 1), n) * amp * 0.35
        x = x + body
    pan = np.clip(np.where(t < tp, -0.8 + 0.8 * t / tp, 0.8 * (t - tp) / (n_post / SR)), -1, 1)
    a = (pan + 1) * np.pi / 4
    st = np.stack([x * np.cos(a), x * np.sin(a)], axis=1)
    return st / (np.max(np.abs(st)) + 1e-9), n_pre


def pop(pitch: float = 1.0) -> np.ndarray:
    n = int(0.09 * SR)
    t = np.arange(n) / SR
    f = (1500 * pitch) * np.exp(-t / 0.02) + 520 * pitch
    y = sine(f, n) * np.exp(-t / 0.028) * np.clip(t / 0.001, 0, 1)
    click = filt(noise(n), 4000, "high") * np.exp(-t / 0.0025) * 0.25
    return y + click


def tick() -> np.ndarray:
    n = int(0.06 * SR)
    t = np.arange(n) / SR
    return (sine(2600, n) * 0.6 + sine(3900, n) * 0.3) * np.exp(-t / 0.014)


def riser(seconds: float) -> np.ndarray:
    n = int(seconds * SR)
    t = np.arange(n) / SR
    u = t / seconds
    fc = 400 * (9000 / 400) ** (u**1.3)
    nz = tv_filter(noise(n), fc, "band", block=128, bw=1.8)
    tone = sum(polyblep_saw(220 * 2 ** (2 * u**1.5) * 2 ** (d / 1200), n, rng.random()) for d in (-12, 0, 11))
    tone = tv_filter(tone, fc * 0.6, "low", block=256)
    y = nz * 0.8 + tone * 0.12
    y *= (u**2.2) * np.clip((1 - u) / 0.01, 0, 1)
    st = np.stack([y, np.roll(y, 240)], axis=1)
    return st / (np.max(np.abs(st)) + 1e-9)


def impact() -> np.ndarray:
    n = int(2.4 * SR)
    t = np.arange(n) / SR
    boom = sine(32 + 60 * np.exp(-t / 0.06), n) * np.exp(-t / 0.55)
    thump = filt(noise(n), 160, "low") * np.exp(-t / 0.05) * 2.5
    cr = crash(1.0, 2.4)
    y = stereo(soft_clip(boom + thump, 1.4)) + stereo(cr, 0) * 0.35
    return y / np.max(np.abs(y))


def ding() -> np.ndarray:
    n = int(2.0 * SR)
    y = bell(86, n) * 0.6 + bell(93, n) * 0.35 + bell(74, n) * 0.4  # D6 + A6 + D5
    st = np.stack([y, np.roll(y, 360)], axis=1)
    return st / np.max(np.abs(st))


def build_sfx() -> np.ndarray:
    sfx = np.zeros((N, 2))
    send = np.zeros((N, 2))

    def place(x, frame, gain, verb=0.0, pre=0):
        s = fr2s(frame) - pre
        add(sfx, x * gain, s)
        if verb:
            add(send, x * gain * verb, s)

    # Transition whooshes, peak exactly on the cut (= beat)
    for sc in TL["scenes"]:
        t = sc.get("tIn")
        if not t:
            continue
        frames = t["frames"]
        pre = max(0.18, frames / FPS * 0.7)
        w, n_pre = whoosh(t["type"], pre=pre, post=0.26)
        place(w, sc["start"], 0.42, verb=0.3, pre=n_pre)

    # Risers into the reveal and the CTA
    for r in TL["risers"]:
        sec = (r["end"] - r["start"]) / FPS
        place(riser(sec), r["start"], 0.30, verb=0.25)
    for f in TL["impacts"]:
        place(impact(), f, 0.62, verb=0.15)
    for f in TL["dings"]:
        place(ding(), f, 0.26, verb=0.6)
    # Softer ding when the CTA wordmark lands
    cta = next(s for s in TL["scenes"] if s["id"] == "cta")
    place(ding(), cta["start"] + TL["ctaBeats"][1], 0.15, verb=0.6)

    # Text pops
    pops: list[tuple[float, float]] = []
    pops += [(w, 1.0 + 0.05 * i) for i, w in enumerate(TL["hookWords"])]
    prob = next(s for s in TL["scenes"] if s["id"] == "problem")
    for i, b in enumerate(TL["problemBeats"]):
        pops.append((prob["start"] + b, 0.9))
        if i < 3:
            # strike-through swipe on the following beat
            w, n_pre = whoosh("whip", pre=0.08, post=0.12)
            place(w, prob["start"] + b + 15, 0.18, pre=n_pre)
    reveal = next(s for s in TL["scenes"] if s["id"] == "reveal")
    pops.append((reveal["start"] + 15, 1.1))
    fb = TL["featureBeats"]
    for sc in TL["scenes"]:
        sid = sc["id"]
        if sid.startswith("f"):
            pops.append((sc["start"] + fb["caption1"], 1.0))
            pops.append((sc["start"] + fb["caption2"], 1.15))
            for m in TL["featureMarks"][sid]:
                place(stereo(tick(), 0.2), sc["start"] + m["at"], 0.10, verb=0.3)
        elif sid.startswith("c"):
            if sid != "cta" and sid not in ("credA", "credB"):
                pops.append((sc["start"] + TL["cutawayWord"], 0.95))
    cb = TL["credBeats"]
    for sid, keys in (("credA", ("a1", "a2")), ("credB", ("b1", "b2"))):
        sc = next(s for s in TL["scenes"] if s["id"] == sid)
        for i, k in enumerate(keys):
            pops.append((sc["start"] + cb[k], 0.95 + 0.1 * i))
    for i, b in enumerate(TL["ctaBeats"]):
        if i == 1:
            continue  # ding instead
        pops.append((cta["start"] + b, 1.0 + 0.06 * i))
    for fr, p in pops:
        place(stereo(pop(p), 0.0), fr, 0.13, verb=0.2)

    sfx += reverb(send) * 0.18
    sfx = filt(sfx, 40, "high")
    return sfx


# ----------------------------------------------------------------------------
# Loudness / limiting (measured with ffmpeg's EBU R128 implementation)
# ----------------------------------------------------------------------------
def write_wav(path: Path, x: np.ndarray) -> None:
    y = np.clip(x, -1, 1)
    pcm = np.round(y * (2**23 - 1)).astype("<i4")
    # pack little-endian int32 -> 24-bit PCM
    b24 = np.frombuffer(pcm.tobytes(), dtype=np.uint8).reshape(-1, 4)[:, :3].tobytes()
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(3)
        w.setframerate(SR)
        w.writeframes(b24)


def measure(path: Path) -> dict:
    out = subprocess.run(
        ["ffmpeg", "-hide_banner", "-nostats", "-i", str(path), "-af", "ebur128=peak=true", "-f", "null", "-"],
        capture_output=True, text=True,
    ).stderr
    summ = out[out.rfind("Summary:"):]
    i = float(re.search(r"I:\s+(-?[\d.]+) LUFS", summ).group(1))
    lra = float(re.search(r"LRA:\s+(-?[\d.]+) LU", summ).group(1))
    tp = float(re.search(r"Peak:\s+(-?[\d.inf]+) dBFS", summ).group(1))
    return {"I": i, "LRA": lra, "TP": tp}


def limiter_gain(x: np.ndarray, ceiling_db: float, lookahead: float = 0.005, hold: float = 0.03) -> np.ndarray:
    """Look-ahead peak limiter gain curve from a 4x oversampled (true-peak) detector.

    min-filter (look-ahead + hold) followed by a Hann smoother of half-width
    `lookahead`: the smoothed gain is never above what each peak requires.
    """
    ceil = 10 ** (ceiling_db / 20)
    up = signal.resample_poly(x, 4, 1, axis=0)
    pk = np.max(np.abs(up), axis=1)[: 4 * len(x)].reshape(-1, 4).max(axis=1)
    need = np.minimum(1.0, ceil / np.maximum(pk, 1e-9))
    la = int(lookahead * SR)
    held = -maximum_filter1d(-need, size=2 * int(hold * SR) + 1)
    win = np.hanning(2 * la + 1)
    win /= win.sum()
    padded = np.pad(held, la, mode="edge")
    return np.convolve(padded, win, mode="valid")


def main() -> None:
    print("synthesizing music ...", flush=True)
    music = build_music()
    print("synthesizing sfx ...", flush=True)
    sfx = build_sfx()

    mix = music + sfx
    tmp = HERE / "_measure.wav"
    gain = 1.0 / np.max(np.abs(mix)) * 0.5
    for it in range(4):
        y = mix * gain
        g = limiter_gain(y, CEILING_DBTP)
        y = y * g[:, None]
        write_wav(tmp, y)
        m = measure(tmp)
        print(f"  pass {it}: gain {20*np.log10(gain):+.2f} dB -> I {m['I']:.2f} LUFS, TP {m['TP']:.2f} dBTP, "
              f"max GR {-20*np.log10(g.min()):.2f} dB", flush=True)
        if abs(m["I"] - TARGET_LUFS) < 0.15 and m["TP"] < -1.0:
            break
        gain *= 10 ** ((TARGET_LUFS - m["I"]) / 20)
    tmp.unlink(missing_ok=True)

    music_out = music * gain * g[:, None]
    sfx_out = sfx * gain * g[:, None]
    out_dir = ROOT / "public" / "audio"
    out_dir.mkdir(parents=True, exist_ok=True)
    write_wav(out_dir / "docknee-music.wav", music_out)
    write_wav(out_dir / "docknee-sfx.wav", sfx_out)
    write_wav(HERE / "docknee-mix.wav", music_out + sfx_out)
    final = measure(HERE / "docknee-mix.wav")
    print(f"final mix: I {final['I']:.2f} LUFS, LRA {final['LRA']:.1f} LU, TP {final['TP']:.2f} dBTP")
    print(f"music stem: {measure(out_dir / 'docknee-music.wav')}")
    print(f"sfx stem:   {measure(out_dir / 'docknee-sfx.wav')}")


if __name__ == "__main__":
    sys.exit(main())
