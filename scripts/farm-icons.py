#!/usr/bin/env python3
"""Chép hình Twemoji cho game Nông trại (để mọi máy, kể cả Android cũ / Huawei, hiện giống nhau).

Hình: Twemoji (https://github.com/jdecked/twemoji), giấy phép CC-BY 4.0 — xem public/farm/emoji/LICENSE.txt.

Chạy (một lần, khi thêm cây / món mới có biểu tượng mới):
  npm install --prefix /tmp/twe @twemoji/svg@15.0.0
  python3 scripts/farm-icons.py /tmp/twe/node_modules/@twemoji/svg
Ghi ra:
  public/farm/emoji/<mã>.svg          bản web
  native/assets/farm/<mã>.png         App Think Beta (vẽ ra PNG 128×128 bằng Playwright + Chromium)
  native/src/farm/icons.ts            bảng mã → file PNG cho app
"""
import json
import os
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = sys.argv[1] if len(sys.argv) > 1 else '/tmp/twe/node_modules/@twemoji/svg'
WEB = os.path.join(ROOT, 'public', 'farm', 'emoji')
APP = os.path.join(ROOT, 'native', 'assets', 'farm')
TS = os.path.join(ROOT, 'native', 'src', 'farm', 'icons.ts')

# Biểu tượng dùng trong giao diện (ngoài các cây / món / công trình trong src/farm-data.js)
UI = ['🪙', '⭐', '🐕', '🐛', '🌱', '📦', '📋', '🛒', '🎁', '🧺', '🔒', '✨', '🏆', '🚜', '👨‍🌾', '😤', '🥇', '🥈', '🥉',
      '🔨', '👥', '📒', '⏳', '🗑️', '🎉', '🌧️', '☀️', '💰']


def key(ch):
    """Tên file Twemoji: mã Unicode viết thường nối bằng '-', bỏ FE0F nếu không phải chuỗi ghép (ZWJ)"""
    cps = [ord(c) for c in ch]
    if 0x200D not in cps:
        cps = [c for c in cps if c != 0xFE0F]
    return '-'.join(f'{c:x}' for c in cps)


def catalog_emojis():
    js = ("const D=require('./src/farm-data');"
          "console.log(JSON.stringify([...D.CROPS,...D.PRODUCTS,...D.BUILDINGS,...D.DECOR,...D.CUSTOMERS].map(x=>x.emoji)))")
    return json.loads(subprocess.check_output(['node', '-e', js], cwd=ROOT))


def main():
    emojis = []
    for e in catalog_emojis() + UI:
        if e not in emojis:
            emojis.append(e)
    os.makedirs(WEB, exist_ok=True)
    os.makedirs(APP, exist_ok=True)
    keys = []
    for e in emojis:
        k = key(e)
        src = os.path.join(SRC, f'{k}.svg')
        if not os.path.exists(src):
            sys.exit(f'Không có hình cho {e} ({k})')
        shutil.copy(src, os.path.join(WEB, f'{k}.svg'))
        keys.append(k)

    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page(viewport={'width': 128, 'height': 128})
        for k in keys:
            svg = open(os.path.join(WEB, f'{k}.svg'), encoding='utf-8').read()
            svg = svg.replace('<svg ', '<svg width="128" height="128" ', 1)
            page.set_content('<html><body style="margin:0;background:transparent">'
                             f'<div style="width:128px;height:128px">{svg}</div></body></html>')
            page.screenshot(path=os.path.join(APP, f'{k}.png'), omit_background=True)
        browser.close()

    lines = [
        '// Tạo bằng scripts/farm-icons.py — đừng sửa tay. Hình Twemoji (CC-BY 4.0).',
        'export const ICONS: Record<string, number> = {',
    ]
    lines += [f'  "{k}": require("../../assets/farm/{k}.png"),' for k in keys]
    lines += ['};', '']
    os.makedirs(os.path.dirname(TS), exist_ok=True)
    with open(TS, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))
    print(f'Đã chép {len(keys)} hình')


main()
