#!/usr/bin/env python3
"""Tạo âm thanh cho game Xếp Khối của Think (tự tổng hợp, dùng tự do).

Cầm khối "bíp" nhẹ, đặt khối "cộp" gọn như khối nhựa đặc, ăn hàng là tiếng lấp lánh đi lên,
combo càng dài nốt càng cao, dọn sạch bàn / kỷ lục mới có nhạc chiến thắng, thua là ba nốt đi xuống.

Chạy: python3 scripts/blocks-sounds.py
Ghi ra public/blocks/sounds/*.wav (bản web) và native/assets/sounds/blocks/*.wav (App Think Beta).
Cần numpy và scipy.
"""
import os
import wave

import numpy as np
from scipy.signal import butter, lfilter, sosfilt

RATE = 32000
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = [os.path.join(ROOT, 'public', 'blocks', 'sounds'), os.path.join(ROOT, 'native', 'assets', 'sounds', 'blocks')]
rng = np.random.default_rng(88)


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


def env(t, attack, tau):
    return np.minimum(1, t / max(attack, 1e-4)) * np.exp(-t / tau)


def tone(freq, sec, tau, attack=0.004, partials=((1, 1.0), (2, 0.3), (3, 0.12))):
    t = axis(sec)
    y = np.zeros(len(t))
    for mult, g in partials:
        if freq * mult > RATE * 0.45:
            continue  # bỏ bội quá cao (trên giới hạn tần số của file) để không bị méo tiếng
        y += g * np.sin(2 * np.pi * freq * mult * t) * np.exp(-t / (tau / mult ** 0.5))
    return y * np.minimum(1, t / attack)


def bell(freq, sec=0.7, tau=0.35):
    """Chuông trong (glockenspiel): các bội không nguyên làm tiếng "lấp lánh" """
    return tone(freq, sec, tau, 0.002, ((1, 1.0), (2.76, 0.35), (5.4, 0.18), (8.93, 0.08)))


def glide(f0, f1, sec, tau, shape=np.sin):
    t = axis(sec)
    f = f0 * (f1 / f0) ** (t / sec)
    phase = 2 * np.pi * np.cumsum(f) / RATE
    return shape(phase) * env(t, 0.003, tau)


def sparkle(sec, tau, density=0.004):
    """Tiếng lấp lánh: nhiều nốt chuông nhỏ ngẫu nhiên ở quãng cao"""
    out = np.zeros(int(RATE * sec))
    n = int(sec / density)
    for _ in range(n):
        start = rng.uniform(0, sec * 0.6)
        f = rng.choice([2093, 2349.3, 2637, 3136, 3520, 4186])
        s = bell(f, 0.25, 0.06) * rng.uniform(0.2, 0.6) * np.exp(-start / tau)
        i = int(start * RATE)
        m = min(len(s), len(out) - i)
        out[i:i + m] += s[:m]
    return out


def whoosh(sec, f0, f1, tau):
    t = axis(sec)
    noise = rng.standard_normal(len(t))
    out = np.zeros(len(t))
    steps = 24
    for k in range(steps):
        a, b = int(len(t) * k / steps), int(len(t) * (k + 1) / steps)
        fc = f0 * (f1 / f0) ** (k / steps)
        out[a:b] = band(noise, fc * 0.8, fc * 1.25)[a:b]
    return out * np.sin(np.pi * np.clip(t / sec, 0, 1)) ** 2 * np.exp(-t / tau)


def mix(sec, parts):
    out = np.zeros(int(RATE * sec))
    for start, sig, gain in parts:
        i = int(RATE * start)
        n = min(len(sig), len(out) - i)
        if n > 0:
            out[i:i + n] += sig[:n] * gain
    return out


def finish(x, peak):
    x = highpass(x, 50)
    x = x / (np.max(np.abs(x)) or 1) * peak
    fade = int(RATE * 0.015)
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


def block_knock(sec=0.14, pitch=1.0):
    """Khối nhựa đặc rơi xuống khay: "cộp" tròn, có chút tiếng rỗng"""
    exc = np.zeros(int(RATE * sec))
    k = int(RATE * 0.0012)
    exc[:k] = np.sin(np.linspace(0, np.pi, k))
    out = np.zeros(len(exc))
    for f, tau, g in [(310, 0.030, 1.0), (620, 0.020, 0.55), (1180, 0.012, 0.35), (2250, 0.006, 0.2), (160, 0.035, 0.6)]:
        y = resonator(exc, f * pitch, tau)
        out += g * y / (np.max(np.abs(y)) or 1)
    t = axis(sec)
    out += 0.25 * band(rng.standard_normal(len(t)), 1500, 6000) * np.exp(-t / 0.004)
    return out


# Cầm khối lên
save('pick', finish(glide(700, 1050, 0.08, 0.03), 0.35))
# Đặt khối
save('place', finish(mix(0.2, [(0, block_knock(0.18), 1.0), (0.004, glide(260, 150, 0.09, 0.03), 0.5)]), 0.75))
# Thả sai chỗ: khối bay về
save('invalid', finish(glide(420, 190, 0.18, 0.06, lambda p: np.sign(np.sin(p)) * 0.4 + np.sin(p)), 0.35))

# Ăn hàng: tiếng quét lên + hợp âm chuông, càng nhiều hàng càng dày
C6, E6, G6, C7, E7, G7 = 1046.5, 1318.5, 1568.0, 2093.0, 2637.0, 3136.0
save('clear1', finish(mix(0.7, [
    (0.00, whoosh(0.25, 800, 4000, 0.2), 0.5),
    (0.02, bell(C6, 0.6), 1.0), (0.07, bell(E6, 0.6), 0.9), (0.12, bell(G6, 0.6), 0.9),
    (0.05, sparkle(0.6, 0.2, 0.02), 0.5),
]), 0.7))
save('clear2', finish(mix(0.9, [
    (0.00, whoosh(0.3, 700, 5000, 0.25), 0.6),
    (0.02, bell(C6, 0.7), 1.0), (0.06, bell(E6, 0.7), 0.9), (0.10, bell(G6, 0.7), 0.9), (0.14, bell(C7, 0.8), 1.0),
    (0.05, sparkle(0.8, 0.3, 0.012), 0.6),
]), 0.75))
save('clear3', finish(mix(1.2, [
    (0.00, whoosh(0.35, 600, 6000, 0.3), 0.7),
    (0.00, glide(180, 60, 0.4, 0.15), 0.8),  # tiếng "bùm" trầm
    (0.02, bell(C6, 0.8), 1.0), (0.05, bell(E6, 0.8), 0.9), (0.08, bell(G6, 0.8), 0.9),
    (0.11, bell(C7, 0.9), 1.0), (0.14, bell(E7, 0.9), 0.8), (0.17, bell(G7, 1.0), 0.7),
    (0.05, sparkle(1.0, 0.35, 0.008), 0.7),
]), 0.8))

# Combo: nốt chuông đi lên theo âm giai ngũ cung, mỗi bậc combo cao hơn
PENTA = [1046.5, 1174.7, 1318.5, 1568.0, 1760.0, 2093.0, 2349.3, 2637.0]
for i in range(8):
    f = PENTA[i]
    save(f'combo{i + 1}', finish(mix(0.6, [
        (0.00, bell(f, 0.55, 0.28), 1.0),
        (0.06, bell(f * 1.5, 0.5, 0.22), 0.55),
    ]), 0.55))

# Dọn sạch bàn: nhạc hiệu ngắn
save('allclear', finish(mix(1.6, [
    (0.00, whoosh(0.4, 500, 7000, 0.35), 0.6),
    *[(0.09 * k, bell(f, 0.9, 0.4), 0.95) for k, f in enumerate([C6, E6, G6, C7, E7, G7])],
    (0.55, bell(C7, 1.0, 0.55), 0.9), (0.55, bell(E7, 1.0, 0.55), 0.7), (0.55, bell(G6, 1.0, 0.55), 0.7),
    (0.1, sparkle(1.4, 0.6, 0.006), 0.8),
]), 0.8))
# Kỷ lục mới
save('best', finish(mix(1.5, [
    (0.00, bell(G6 / 2, 0.5, 0.2), 0.9), (0.12, bell(C6, 0.5, 0.2), 0.9), (0.24, bell(E6, 0.5, 0.2), 0.9),
    (0.40, bell(G6, 1.0, 0.5), 1.0), (0.40, bell(C7, 1.0, 0.5), 0.8), (0.40, bell(E6, 1.0, 0.5), 0.6),
    (0.4, sparkle(1.0, 0.5, 0.008), 0.7),
]), 0.8))
# Hết nước đi (thua)
save('gameover', finish(mix(1.4, [
    (0.00, tone(659.3, 0.6, 0.25), 1.0),
    (0.22, tone(523.3, 0.6, 0.25), 1.0),
    (0.44, tone(440.0, 0.6, 0.28), 1.0),
    (0.66, tone(329.6, 0.8, 0.45), 1.0),
]), 0.6))
# Bắt đầu ván mới
save('start', finish(mix(0.8, [
    (0.00, whoosh(0.35, 400, 3000, 0.3), 0.7),
    (0.12, bell(C6, 0.6, 0.25), 0.8), (0.2, bell(G6, 0.6, 0.3), 0.8),
]), 0.6))
print('Đã tạo âm thanh trong', ', '.join(OUT))
