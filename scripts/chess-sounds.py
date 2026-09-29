#!/usr/bin/env python3
"""Tạo âm thanh cờ vua cho Think (tự tổng hợp, không lấy file của ai nên dùng tự do).

Phong cách giống các trang cờ lớn: tiếng quân gỗ đặt xuống bàn giòn, gọn; ăn quân nghe "cạch" mạnh hơn;
nhập thành hai tiếng liền; chiếu tướng có thêm tiếng "tính" cao; bắt đầu / kết thúc ván là tiếng chuông gỗ nhẹ.

Chạy: python3 scripts/chess-sounds.py
Ghi ra public/chess/sounds/*.wav (bản web) và native/assets/sounds/*.wav (App Think Beta).
Cần numpy và scipy.
"""
import os
import wave

import numpy as np
from scipy.signal import butter, lfilter, sosfilt

RATE = 44100
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = [os.path.join(ROOT, 'public', 'chess', 'sounds'), os.path.join(ROOT, 'native', 'assets', 'sounds')]
rng = np.random.default_rng(20260929)


def silence(sec):
    return np.zeros(int(RATE * sec))


def resonator(x, freq, tau):
    """Bộ cộng hưởng hai cực: một "mode" dao động của mảnh gỗ, tắt dần theo tau giây"""
    r = np.exp(-1.0 / (tau * RATE))
    w = 2 * np.pi * freq / RATE
    b = [1 - r]
    a = [1, -2 * r * np.cos(w), r * r]
    return lfilter(b, a, x)


def band(x, lo, hi, order=2):
    sos = butter(order, [lo, hi], btype='band', fs=RATE, output='sos')
    return sosfilt(sos, x)


def highpass(x, f, order=2):
    sos = butter(order, f, btype='high', fs=RATE, output='sos')
    return sosfilt(sos, x)


def lowpass(x, f, order=2):
    sos = butter(order, f, btype='low', fs=RATE, output='sos')
    return sosfilt(sos, x)


def impulse(sec, width=0.0006, hardness=1.0):
    """Cú chạm: xung ngắn (quân gỗ chạm mặt bàn). width nhỏ = chạm cứng, nhiều tần số cao"""
    n = int(RATE * sec)
    x = np.zeros(n)
    k = max(2, int(RATE * width))
    x[:k] = np.sin(np.linspace(0, np.pi, k)) ** (1.5 / hardness)
    return x


def contact_noise(sec, tau, lo, hi):
    n = int(RATE * sec)
    t = np.arange(n) / RATE
    return band(rng.standard_normal(n), lo, hi) * np.exp(-t / tau)


def knock(sec=0.16, pitch=1.0, bright=1.0, body=1.0, width=0.0006):
    """Tiếng quân gỗ đặt xuống bàn gỗ: mode cao của quân + mode trầm của mặt bàn + tiếng tách lúc chạm"""
    exc = impulse(sec, width)
    modes = [
        # (tần số, thời gian tắt, độ lớn): quân cờ (gỗ cứng, nhỏ) kêu giòn ở 1–5 kHz
        (1180, 0.022, 1.00),
        (1960, 0.013, 0.55 * bright),
        (2930, 0.0085, 0.42 * bright),
        (4150, 0.0055, 0.30 * bright),
        (6100, 0.0035, 0.18 * bright),
    ]
    board = [
        # mặt bàn: tiếng "cộc" trầm, rỗng
        (205, 0.030, 0.55 * body),
        (410, 0.020, 0.40 * body),
        (690, 0.016, 0.28 * body),
    ]
    out = np.zeros(len(exc))
    for f, tau, g in modes + board:
        y = resonator(exc, f * pitch, tau)
        out += g * y / (np.max(np.abs(y)) or 1)
    out += 0.55 * bright * contact_noise(sec, 0.0035, 2500, 9500) / 3.0
    return out


def ping(sec, freqs, tau, gain=1.0):
    """Tiếng "tính" trong trẻo (chuông nhỏ / gõ kim loại nhẹ)"""
    t = np.arange(int(RATE * sec)) / RATE
    y = np.zeros(len(t))
    for i, f in enumerate(freqs):
        y += (0.6 ** i) * np.sin(2 * np.pi * f * t) * np.exp(-t / (tau / (1 + 0.6 * i)))
    return gain * y * np.minimum(1, t / 0.002)


def marimba(freq, sec=0.6, tau=0.22):
    """Nốt chuông gỗ (kiểu marimba): phần tử cơ bản + bội 4 tắt nhanh"""
    t = np.arange(int(RATE * sec)) / RATE
    y = (
        np.sin(2 * np.pi * freq * t) * np.exp(-t / tau)
        + 0.30 * np.sin(2 * np.pi * freq * 3.9 * t) * np.exp(-t / (tau * 0.18))
        + 0.12 * np.sin(2 * np.pi * freq * 9.2 * t) * np.exp(-t / (tau * 0.06))
    )
    return y * np.minimum(1, t / 0.003)


def mix(total_sec, parts):
    out = np.zeros(int(RATE * total_sec))
    for start, sig, gain in parts:
        i = int(RATE * start)
        n = min(len(sig), len(out) - i)
        if n > 0:
            out[i:i + n] += sig[:n] * gain
    return out


def finish(x, peak):
    x = highpass(x, 60, 1)
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


# Đi quân (của mình): tiếng "cộc" giòn, gọn
save('move', finish(knock(0.16), 0.80))
# Đối thủ đi: cùng chất gỗ nhưng trầm hơn một chút để phân biệt
save('move-opp', finish(knock(0.16, pitch=0.9, bright=0.8, body=1.15), 0.72))
# Ăn quân: chạm mạnh + hai quân va nhau ("cạch")
save('capture', finish(mix(0.24, [
    (0.000, knock(0.2, pitch=1.18, bright=1.5, body=1.2, width=0.0004), 1.0),
    (0.028, knock(0.18, pitch=1.42, bright=1.3, body=0.4, width=0.0004), 0.55),
]), 0.88))
# Nhập thành: Vua rồi Xe
save('castle', finish(mix(0.30, [
    (0.000, knock(0.16), 1.0),
    (0.105, knock(0.16, pitch=0.93, body=1.1), 0.85),
]), 0.80))
# Chiếu tướng: tiếng quân + tiếng "tính" cao báo động nhẹ
save('check', finish(mix(0.36, [
    (0.000, knock(0.16, pitch=1.08, bright=1.2), 1.0),
    (0.012, ping(0.3, [1568, 3136, 4704], 0.085), 0.42),
]), 0.84))
# Phong cấp: tiếng quân + hai nốt đi lên
save('promote', finish(mix(0.55, [
    (0.000, knock(0.16), 1.0),
    (0.060, marimba(1318.5, 0.4, 0.12), 0.45),
    (0.140, marimba(1975.5, 0.4, 0.14), 0.45),
]), 0.80))
# Bắt đầu ván: hai nốt chuông gỗ đi lên
save('start', finish(mix(0.75, [
    (0.00, marimba(783.99, 0.6, 0.20), 1.0),
    (0.13, marimba(1046.5, 0.6, 0.24), 1.0),
]), 0.55))
# Kết thúc ván: ba nốt đi xuống, nhẹ nhàng
save('end', finish(mix(1.0, [
    (0.00, marimba(1046.5, 0.6, 0.20), 1.0),
    (0.14, marimba(783.99, 0.6, 0.22), 0.95),
    (0.28, marimba(523.25, 0.7, 0.30), 1.0),
]), 0.55))
# Nước không hợp lệ: tiếng "bụp" trầm, ngắn
t = np.arange(int(RATE * 0.16)) / RATE
thud = np.sign(np.sin(2 * np.pi * 110 * t)) * np.exp(-t / 0.035)
save('illegal', finish(mix(0.2, [(0, lowpass(thud, 700, 2), 1.0), (0.07, lowpass(thud, 700, 2), 0.7)]), 0.5))
# Sắp hết giờ (còn 10 giây): tích tắc
save('lowtime', finish(mix(0.5, [
    (0.00, knock(0.08, pitch=1.9, bright=0.6, body=0.2), 1.0),
    (0.25, knock(0.08, pitch=1.6, bright=0.6, body=0.2), 0.9),
]), 0.5))
print('Đã tạo âm thanh trong', ', '.join(OUT))
