#!/usr/bin/env python3
"""Tạo âm thanh cho game Nông trại của Think (tự tổng hợp, dùng tự do).

Trồng cây là tiếng đất "bụp" nhẹ, thu hoạch là tiếng hái giòn vui tai, bán hàng / giao đơn có tiếng
xu "keng", lên cấp có nhạc hiệu, bắt sâu "chụt", hái trộm rón rén, chó sủa "gâu gâu".

Chạy: python3 scripts/farm-sounds.py
Ghi ra public/farm/sounds/*.wav (bản web) và native/assets/sounds/farm/*.wav (App Think Beta).
Cần numpy và scipy.
"""
import os
import wave

import numpy as np
from scipy.signal import butter, lfilter, sosfilt

RATE = 32000
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = [os.path.join(ROOT, 'public', 'farm', 'sounds'), os.path.join(ROOT, 'native', 'assets', 'sounds', 'farm')]
rng = np.random.default_rng(22)


def axis(sec):
    return np.arange(int(RATE * sec)) / RATE


def resonator(x, freq, tau):
    r = np.exp(-1.0 / (tau * RATE))
    w = 2 * np.pi * freq / RATE
    return lfilter([1 - r], [1, -2 * r * np.cos(w), r * r], x)


def band(x, lo, hi, order=2):
    return sosfilt(butter(order, [lo, hi], btype='band', fs=RATE, output='sos'), x)


def lowpass(x, f, order=2):
    return sosfilt(butter(order, f, btype='low', fs=RATE, output='sos'), x)


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
    return tone(freq, sec, tau, 0.002, ((1, 1.0), (3.9, 0.25), (9.2, 0.06)))


def pluck(freq, sec=0.35, tau=0.09):
    """Gảy dây ngắn (pizzicato): giòn, tắt nhanh"""
    return tone(freq, sec, tau, 0.001, ((1, 1.0), (2, 0.5), (3, 0.25), (4, 0.12)))


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


def thump(sec=0.22, freq=95):
    """Đất mềm: tiếng "bụp" trầm + chút lạo xạo"""
    t = axis(sec)
    glide = freq * (1 + 0.8 * np.exp(-t / 0.02))
    body = np.sin(2 * np.pi * np.cumsum(glide) / RATE) * np.exp(-t / 0.05)
    dirt = lowpass(rng.standard_normal(len(t)), 1800) * np.exp(-t / 0.03) * 0.5
    return body + dirt


def pop(sec=0.12, f0=900, f1=300):
    """Tiếng "chụt" (bắt sâu, bong bóng)"""
    t = axis(sec)
    f = f1 + (f0 - f1) * np.exp(-t / 0.015)
    return np.sin(2 * np.pi * np.cumsum(f) / RATE) * np.exp(-t / 0.03)


def coin(f=1975.5):
    """Đồng xu: hai tiếng kim loại sáng"""
    metal = band(rng.standard_normal(int(RATE * 0.05)), 5000, 11000) * np.exp(-axis(0.05) / 0.008) * 0.3
    return mix(0.5, [(0, bell(f, 0.4, 0.12), 1.0), (0, metal, 1.0), (0.07, bell(f * 4 / 3, 0.4, 0.16), 0.9)])


def woof(f0=420, f1=230, sec=0.16):
    """Chó sủa: âm răng cưa trượt giọng qua bộ lọc "miệng" + hơi thở"""
    t = axis(sec)
    f = f1 + (f0 - f1) * np.exp(-t / 0.05)
    phase = np.cumsum(f) / RATE
    saw = 2 * (phase % 1) - 1
    env = np.minimum(1, t / 0.008) * np.exp(-t / 0.06)
    voice = band(saw, 350, 1600, 2) * env
    breath = band(rng.standard_normal(len(t)), 800, 3000) * env * 0.35
    return resonator(voice, 700, 0.01) * 0.6 + voice + breath


def knock(freq=420):
    t = axis(0.12)
    exc = np.zeros(len(t))
    exc[:24] = np.hanning(24)
    out = resonator(exc, freq, 0.03) + 0.5 * resonator(exc, freq * 2.4, 0.012)
    return out / (np.max(np.abs(out)) or 1)


C5, D5, E5, G5, A5 = 523.3, 587.3, 659.3, 784.0, 880.0
C6, E6, G6, C7 = 1046.5, 1318.5, 1568.0, 2093.0

# Gieo hạt
save('plant', finish(mix(0.3, [(0, thump(), 1.0), (0.03, pop(0.08, 1500, 700), 0.18)]), 0.6))
# Thu hoạch: tiếng hái "tách" + hai nốt vui
save('harvest', finish(mix(0.45, [(0, pop(0.08, 2400, 900), 0.6), (0.02, marimba(G5, 0.3, 0.1), 0.8), (0.1, marimba(C6, 0.35, 0.12), 0.9)]), 0.65))
# Bán hàng ở chợ
save('coin', finish(coin(), 0.55))
# Giao đơn hàng: chuông quầy + xu
save('order', finish(mix(0.9, [(0, bell(C6, 0.6, 0.25), 0.8), (0.12, bell(G6, 0.6, 0.25), 0.8), (0.25, coin(2349.3), 0.9)]), 0.65))
# Bắt đầu làm món (máy chạy)
save('craft', finish(mix(0.35, [(0, knock(300), 0.8), (0.09, knock(360), 0.6), (0.14, band(rng.standard_normal(int(RATE * 0.18)), 300, 1500) * np.exp(-axis(0.18) / 0.06), 0.25)]), 0.5))
# Lấy hàng đã làm xong
save('collect', finish(mix(0.6, [(0, marimba(E5, 0.3, 0.1), 0.8), (0.07, marimba(G5, 0.3, 0.1), 0.8), (0.14, marimba(C6, 0.4, 0.14), 0.9), (0.14, bell(C7, 0.4, 0.1), 0.25)]), 0.6))
# Lên cấp: nhạc hiệu + lấp lánh
spark = mix(1.2, [(rng.uniform(0.25, 0.9), bell(rng.choice([2093, 2349.3, 2637, 3136, 3520]), 0.3, 0.06), rng.uniform(0.2, 0.5)) for _ in range(20)])
save('levelup', finish(mix(1.7, [
    (0.00, marimba(C5, 0.4, 0.15), 0.8), (0.09, marimba(E5, 0.4, 0.15), 0.8), (0.18, marimba(G5, 0.4, 0.15), 0.8),
    (0.30, bell(C6, 1.2, 0.5), 1.0), (0.30, bell(E6, 1.2, 0.5), 0.7), (0.30, bell(G6, 1.2, 0.5), 0.65), (0.30, bell(C7, 1.3, 0.55), 0.55),
    (0.3, spark, 0.8),
]), 0.8))
# Bắt sâu
save('bug', finish(mix(0.25, [(0, pop(0.12, 1100, 250), 1.0), (0.05, band(rng.standard_normal(int(RATE * 0.05)), 1500, 5000) * np.exp(-axis(0.05) / 0.01), 0.3)]), 0.55))
# Hái trộm: rón rén (gảy dây đi xuống, nhỏ)
save('steal', finish(mix(0.9, [(0.0, pluck(G5), 0.9), (0.15, pluck(E5), 0.8), (0.3, pluck(C5), 0.8), (0.45, pluck(D5 / 2 * 1.5), 0.6), (0.6, pop(0.1, 2600, 1000), 0.5)]), 0.5))
# Chó sủa
save('dog', finish(mix(0.6, [(0, woof(), 1.0), (0.24, woof(460, 250, 0.15), 0.9)]), 0.6))
# Xây công trình / mua đồ: gõ búa
save('build', finish(mix(0.6, [(0, knock(520), 1.0), (0.16, knock(560), 0.9), (0.32, knock(600), 1.0), (0.36, bell(E6, 0.3, 0.1), 0.3)]), 0.55))
# Quà mỗi ngày: chuỗi chuông đi lên
save('gift', finish(mix(1.0, [(0.06 * i, bell(f, 0.5, 0.15), 0.7) for i, f in enumerate([C6, 1174.7, E6, 1396.9, G6, 1760, 1975.5, C7])]), 0.6))
# Không làm được (thiếu xu, thiếu nguyên liệu)
save('error', finish(mix(0.3, [(0, marimba(220, 0.2, 0.05), 1.0), (0.07, marimba(196, 0.18, 0.04), 0.8)]), 0.4))
print('Đã tạo âm thanh trong', ', '.join(OUT))
