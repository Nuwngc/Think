#!/usr/bin/env python3
"""Tạo âm thanh cờ vua cho Think (tự tổng hợp, không lấy của ai nên dùng tự do).

Chạy: python3 scripts/chess-sounds.py
Ghi ra public/chess/sounds/*.wav (bản web) và native/assets/sounds/*.wav (App Think Beta).
Cần numpy.
"""
import os
import wave

import numpy as np

RATE = 22050
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = [os.path.join(ROOT, 'public', 'chess', 'sounds'), os.path.join(ROOT, 'native', 'assets', 'sounds')]
rng = np.random.default_rng(7)


def t_axis(sec):
    return np.arange(int(RATE * sec)) / RATE


def decay(t, tau):
    return np.exp(-t / tau)


def lowpass(x, cutoff):
    # Bộ lọc một cực đơn giản
    a = np.exp(-2 * np.pi * cutoff / RATE)
    y = np.zeros_like(x)
    prev = 0.0
    for i, v in enumerate(x):
        prev = (1 - a) * v + a * prev
        y[i] = prev
    return y


def knock(sec=0.12, pitch=1.0, weight=1.0):
    """Tiếng quân gỗ đặt xuống bàn: tiếng 'cộc' trầm + tiếng 'tách' ngắn"""
    t = t_axis(sec)
    body = (
        1.00 * np.sin(2 * np.pi * 190 * pitch * t) * decay(t, 0.028 * weight)
        + 0.55 * np.sin(2 * np.pi * 560 * pitch * t) * decay(t, 0.016)
        + 0.30 * np.sin(2 * np.pi * 1150 * pitch * t) * decay(t, 0.008)
    )
    noise = lowpass(rng.standard_normal(len(t)), 3200) * decay(t, 0.004) * 1.6
    click = np.sin(2 * np.pi * 2600 * pitch * t) * decay(t, 0.0025) * 0.35
    x = body + noise + click
    attack = np.minimum(1, t / 0.0008)
    return x * attack


def place(total_sec, parts):
    out = np.zeros(int(RATE * total_sec))
    for start, sig, gain in parts:
        i = int(RATE * start)
        n = min(len(sig), len(out) - i)
        out[i:i + n] += sig[:n] * gain
    return out


def chime(notes, sec=0.75, gap=0.13):
    t = t_axis(sec)
    out = np.zeros(len(t))
    for k, f in enumerate(notes):
        i = int(RATE * gap * k)
        tt = t[: len(t) - i]
        tone = (
            np.sin(2 * np.pi * f * tt)
            + 0.35 * np.sin(2 * np.pi * 2 * f * tt) * decay(tt, 0.12)
            + 0.12 * np.sin(2 * np.pi * 3 * f * tt) * decay(tt, 0.06)
        ) * decay(tt, 0.26) * np.minimum(1, tt / 0.004)
        out[i:] += tone
    return out


def finish(x, peak):
    x = x - np.mean(x)
    x = x / (np.max(np.abs(x)) or 1) * peak
    fade = int(RATE * 0.01)
    x[-fade:] *= np.linspace(1, 0, fade)
    return x


def save(name, x):
    data = (np.clip(x, -1, 1) * 32767).astype('<i2').tobytes()
    for folder in OUT:
        os.makedirs(folder, exist_ok=True)
        with wave.open(os.path.join(folder, f'{name}.wav'), 'wb') as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(RATE)
            w.writeframes(data)


save('move', finish(knock(0.12), 0.75))
save('capture', finish(place(0.2, [(0, knock(0.13, 0.92, 1.3), 1.0), (0.05, knock(0.12, 1.12), 0.7)]), 0.85))
save('castle', finish(place(0.2, [(0, knock(0.12), 1.0), (0.075, knock(0.12, 1.06), 0.85)]), 0.75))
check_tone = t_axis(0.3)
check = place(0.3, [
    (0, knock(0.12), 1.0),
    (0.01, (np.sin(2 * np.pi * 988 * check_tone) + 0.4 * np.sin(2 * np.pi * 1976 * check_tone)) * decay(check_tone, 0.07), 0.45),
])
save('check', finish(check, 0.8))
save('start', finish(chime([659.25, 987.77], 0.7), 0.5))
save('end', finish(chime([783.99, 659.25, 523.25], 0.9, 0.14), 0.5))
print('Đã tạo âm thanh trong', ', '.join(OUT))
