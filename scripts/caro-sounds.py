#!/usr/bin/env python3
"""Tạo âm thanh cho game Cờ caro của Think (tự tổng hợp, dùng tự do).

Đặt quân là tiếng bút dạ gõ lên giấy ô li ("tách" nhẹ, X và O hơi khác nhau), thắng có nhạc chiến thắng,
thua là ba nốt đi xuống, có 4 quân liền (sắp thắng) thì kêu một tiếng cảnh báo, tới lượt mình thì "ting".

Chạy: python3 scripts/caro-sounds.py
Ghi ra public/caro/sounds/*.wav (bản web) và native/assets/sounds/caro/*.wav (App Think Beta).
Cần numpy và scipy.
"""
import os
import wave

import numpy as np
from scipy.signal import butter, lfilter, sosfilt

RATE = 32000
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = [os.path.join(ROOT, 'public', 'caro', 'sounds'), os.path.join(ROOT, 'native', 'assets', 'sounds', 'caro')]
rng = np.random.default_rng(15)


def axis(sec):
    return np.arange(int(RATE * sec)) / RATE


def resonator(x, freq, tau):
    r = np.exp(-1.0 / (tau * RATE))
    w = 2 * np.pi * freq / RATE
    return lfilter([1 - r], [1, -2 * r * np.cos(w), r * r], x)


def band(x, lo, hi, order=2):
    return sosfilt(butter(order, [lo, hi], btype='band', fs=RATE, output='sos'), x)


def highpass(x, f, order=1):
    return sosfilt(butter(order, f, btype='high', fs=RATE, output='sos'), x)


def tone(freq, sec, tau, attack=0.004, partials=((1, 1.0), (2, 0.3), (3, 0.12))):
    t = axis(sec)
    y = np.zeros(len(t))
    for mult, g in partials:
        if freq * mult > RATE * 0.45:
            continue
        y += g * np.sin(2 * np.pi * freq * mult * t) * np.exp(-t / (tau / mult ** 0.5))
    return y * np.minimum(1, t / attack)


def bell(freq, sec=0.7, tau=0.35):
    return tone(freq, sec, tau, 0.002, ((1, 1.0), (2.76, 0.35), (5.4, 0.18), (8.93, 0.08)))


def marimba(freq, sec=0.5, tau=0.18):
    """Gõ gỗ (marimba): ấm, tắt nhanh"""
    return tone(freq, sec, tau, 0.002, ((1, 1.0), (3.9, 0.25), (9.2, 0.06)))


def mix(sec, parts):
    out = np.zeros(int(RATE * sec))
    for start, sig, gain in parts:
        i = int(RATE * start)
        n = min(len(sig), len(out) - i)
        if n > 0:
            out[i:i + n] += sig[:n] * gain
    return out


def finish(x, peak):
    x = highpass(x, 60)
    x = x / (np.max(np.abs(x)) or 1) * peak
    fade = int(RATE * 0.012)
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


def pen_tap(sec=0.12, body=900, click=4200):
    """Đầu bút gõ lên bàn / giấy: tiếng "tách" giòn + chút thân gỗ bên dưới"""
    t = axis(sec)
    exc = np.zeros(len(t))
    k = int(RATE * 0.0008)
    exc[:k] = np.hanning(k)
    out = np.zeros(len(t))
    for f, tau, g in [(body, 0.018, 1.0), (body * 2.3, 0.010, 0.5), (click, 0.004, 0.45), (body * 0.55, 0.025, 0.35)]:
        y = resonator(exc, f, tau)
        out += g * y / (np.max(np.abs(y)) or 1)
    # Tiếng sột soạt ngắn của bút lướt trên giấy
    out += 0.18 * band(rng.standard_normal(len(t)), 2500, 9000) * np.exp(-t / 0.006)
    return out


# Đặt quân X (bút đỏ) và O (bút xanh): hai tiếng hơi khác cao độ
save('place-x', finish(pen_tap(0.12, 950, 4300), 0.7))
save('place-o', finish(pen_tap(0.12, 820, 3900), 0.7))
# Đối thủ vừa đi (chơi với bạn): tiếng đặt quân nhẹ hơn + "ting" báo tới lượt mình
save('turn', finish(mix(0.45, [(0, pen_tap(0.12, 820, 3900), 0.6), (0.06, bell(1568.0, 0.35, 0.14), 0.35)]), 0.6))
# Ô đã có quân / chưa tới lượt
save('invalid', finish(mix(0.2, [(0, marimba(220, 0.2, 0.05), 1.0), (0.05, marimba(196, 0.15, 0.04), 0.8)]), 0.4))
# Có 4 quân liền, sắp thắng: hai nốt cảnh báo
save('threat', finish(mix(0.45, [(0, marimba(880, 0.3, 0.1), 1.0), (0.11, marimba(1174.7, 0.3, 0.12), 1.0)]), 0.45))
# Bắt đầu ván
save('start', finish(mix(0.7, [(0, marimba(523.3, 0.4, 0.15), 0.9), (0.1, marimba(659.3, 0.4, 0.15), 0.9), (0.2, marimba(784, 0.5, 0.2), 1.0)]), 0.55))
# Thắng: nhạc hiệu vui + lấp lánh
C6, E6, G6, C7 = 1046.5, 1318.5, 1568.0, 2093.0
spark = mix(1.2, [(rng.uniform(0.3, 0.9), bell(rng.choice([2093, 2349.3, 2637, 3136]), 0.3, 0.06), rng.uniform(0.2, 0.5)) for _ in range(18)])
save('win', finish(mix(1.6, [
    (0.00, marimba(523.3, 0.4, 0.15), 0.8), (0.10, marimba(659.3, 0.4, 0.15), 0.8), (0.20, marimba(784, 0.4, 0.15), 0.8),
    (0.34, bell(C6, 1.1, 0.5), 1.0), (0.34, bell(E6, 1.1, 0.5), 0.75), (0.34, bell(G6, 1.1, 0.5), 0.7), (0.34, bell(C7, 1.2, 0.55), 0.6),
    (0.3, spark, 0.8),
]), 0.8))
# Thua
save('lose', finish(mix(1.3, [
    (0.00, marimba(659.3, 0.5, 0.2), 1.0),
    (0.22, marimba(587.3, 0.5, 0.2), 1.0),
    (0.44, marimba(523.3, 0.5, 0.22), 1.0),
    (0.66, marimba(392.0, 0.7, 0.4), 1.0),
]), 0.55))
# Hòa (kín bàn)
save('draw', finish(mix(0.9, [(0, marimba(587.3, 0.5, 0.2), 1.0), (0.18, marimba(587.3, 0.6, 0.3), 0.9)]), 0.5))
print('Đã tạo âm thanh trong', ', '.join(OUT))
