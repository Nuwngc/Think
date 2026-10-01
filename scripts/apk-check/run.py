#!/usr/bin/env python3
"""Kiểm tra APK Think Beta trên máy ảo Android (chạy trong workflow "Kiểm tra APK").

Cài APK, mở app rồi bấm thử lần lượt các màn hình chính như người dùng thật:
chơi Xếp Khối khi chưa đăng nhập, đăng nhập, nhắn tin, cờ vua với máy, Xếp Khối, trang cá nhân,
cho app chạy nền rồi mở lại. Sau mỗi bước chụp màn hình và xem app còn chạy không.
Cuối cùng đọc logcat để tìm lỗi crash (FATAL EXCEPTION, lỗi native, lỗi JavaScript, ANR) và ghi báo cáo.

Chỉ cần adb (có sẵn trong máy chạy GitHub Actions) và Python 3, không cần thư viện ngoài.
Trả về mã lỗi 1 nếu app bị crash hoặc có bước không làm được.
"""
import argparse
import json
import os
import re
import subprocess
import sys
import time
import urllib.request
import xml.etree.ElementTree as ET

PKG = "com.nuwngc.think.beta"
TEST_CRASH = "crash thử để kiểm tra báo lỗi"  # crash cố ý ở bước kiểm tra báo lỗi, không tính là lỗi

ap = argparse.ArgumentParser()
ap.add_argument("--apk", required=True)
ap.add_argument("--out", required=True)
ap.add_argument("--user", default="tester")
ap.add_argument("--password", default="tester12345")
ap.add_argument("--label", default="")
ap.add_argument("--server", default="http://127.0.0.1:3000")
ap.add_argument("--report-checks", action="store_true", help="kiểm tra cả phần báo lỗi app (bản app có phần báo lỗi)")
ap.add_argument("--bubble-checks", action="store_true", help="kiểm tra bong bóng chat (bản app có bong bóng chat)")
ap.add_argument("--admin-password", default=os.environ.get("ADMIN_PASSWORD", "admin-ci-12345"))
args = ap.parse_args()
OUT = args.out
os.makedirs(OUT, exist_ok=True)

results = []  # (bước, ok, ghi chú, ảnh)
shot_no = 0
app_pids = set()  # các tiến trình của app đã thấy (để lọc logcat)


def log(msg):
    print(msg, flush=True)


def adb(*a, timeout=90, binary=False):
    try:
        r = subprocess.run(["adb", *a], capture_output=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return b"" if binary else ""
    return r.stdout if binary else r.stdout.decode("utf-8", "replace") + r.stderr.decode("utf-8", "replace")


def sh(cmd, timeout=90):
    return adb("shell", cmd, timeout=timeout)


def alive():
    pids = sh(f"pidof {PKG}").split()
    app_pids.update(p for p in pids if p.isdigit())
    return any(p.isdigit() for p in pids)


def shot(name):
    global shot_no
    shot_no += 1
    fn = f"{shot_no:02d}-{name}.png"
    data = adb("exec-out", "screencap", "-p", binary=True, timeout=30)
    if data:
        with open(os.path.join(OUT, fn), "wb") as f:
            f.write(data)
    return fn


# ---------- đọc màn hình (uiautomator) ----------

def dump():
    for _ in range(4):
        out = sh("uiautomator dump /sdcard/think-ui.xml", timeout=40)
        if "dumped to" in out:
            xml = adb("exec-out", "cat", "/sdcard/think-ui.xml", timeout=30)
            try:
                return ET.fromstring(xml.encode("utf-8") if isinstance(xml, str) else xml)
            except ET.ParseError:
                pass
        time.sleep(1)
    return None


def nodes(root):
    if root is None:
        return []
    return list(root.iter("node"))


def center(n):
    m = re.findall(r"\d+", n.get("bounds", ""))
    if len(m) != 4:
        return None
    x1, y1, x2, y2 = map(int, m)
    return (x1 + x2) // 2, (y1 + y2) // 2


def find(pattern, root=None, cls=None):
    """Tìm phần tử có chữ hoặc nhãn (content-desc) khớp biểu thức pattern"""
    rx = re.compile(pattern)
    root = root if root is not None else dump()
    for n in nodes(root):
        if cls and n.get("class") != cls:
            continue
        if rx.search(n.get("text") or "") or rx.search(n.get("content-desc") or ""):
            c = center(n)
            if c and c[0] > 0 and c[1] > 0:
                return n
    return None


def wait_for(pattern, timeout=30, cls=None):
    end = time.time() + timeout
    while time.time() < end:
        if not alive():
            return None
        root = dump()
        if dismiss_system_dialogs(root):
            continue
        n = find(pattern, root, cls=cls)
        if n is not None:
            return n
        time.sleep(0.7)
    return None


def tap_xy(x, y):
    sh(f"input tap {x} {y}")
    time.sleep(0.6)


def tap(pattern, timeout=20):
    n = wait_for(pattern, timeout)
    if n is None:
        raise RuntimeError(f"Không thấy '{pattern}' trên màn hình")
    tap_xy(*center(n))
    return n


def type_text(text):
    # input text không gõ được dấu tiếng Việt / khoảng trắng: thay khoảng trắng bằng %s
    sh("input text " + json.dumps(text.replace(" ", "%s")))
    time.sleep(0.4)


def keyboard_shown():
    return "mInputShown=true" in sh("dumpsys input_method | grep mInputShown")


def hide_keyboard():
    if keyboard_shown():
        sh("input keyevent 4")
        time.sleep(0.6)


def back():
    sh("input keyevent 4")
    time.sleep(1.2)


def dismiss_system_dialogs(root=None):
    """Bấm qua hộp thoại của hệ thống (xin quyền, "app đã dừng", "app không phản hồi")"""
    root = root if root is not None else dump()
    for n in nodes(root):
        pkg = n.get("package") or ""
        if pkg == PKG or not pkg.startswith(("com.android", "com.google.android", "android")):
            continue
        text = n.get("text") or ""
        if re.match(r"^(Allow|ALLOW|Cho phép|Close app|Đóng ứng dụng|Wait|OK)$", text):
            log(f"  (bấm hộp thoại hệ thống: {text})")
            tap_xy(*center(n))
            return True
    return False


def launch():
    sh(f"monkey -p {PKG} -c android.intent.category.LAUNCHER 1")
    time.sleep(3)


def score_of(root=None):
    n = find(r"^Điểm \d+", root)
    if n is None:
        return None
    m = re.search(r"\d+", n.get("content-desc") or n.get("text") or "")
    return int(m.group()) if m else None


def play_one_block():
    """Đặt một khối: kéo khối ở khay vào giữa bàn (thử lần lượt 3 khối)"""
    root = dump()
    before = score_of(root)
    board = find(r"^Bàn chơi 8", root)
    if board is None:
        raise RuntimeError("Không thấy bàn chơi Xếp Khối")
    bx, by = center(board)
    slots = [n for n in nodes(root) if (n.get("content-desc") or "").startswith("Khối ")]
    if not slots:
        raise RuntimeError("Không thấy khối nào ở khay")
    for n in slots:
        sx, sy = center(n)
        for dx, dy in [(0, 0), (-120, -120), (120, 120), (-120, 120), (120, -120)]:
            sh(f"input swipe {sx} {sy} {bx + dx} {by + dy + 150} 900")
            time.sleep(1.5)
            after = score_of()
            if after is not None and before is not None and after > before:
                return f"điểm {before} → {after}"
    raise RuntimeError("Kéo khối vào bàn nhưng điểm không đổi")


# ---------- máy chủ thử (kiểm tra báo lỗi đã tới nơi) ----------

def api_call(path, body=None, token=None):
    req = urllib.request.Request(args.server + path, data=json.dumps(body).encode() if body is not None else None, method="POST" if body is not None else "GET")
    req.add_header("content-type", "application/json")
    if token:
        req.add_header("authorization", f"Bearer {token}")
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read() or b"{}")


def login_token(user, password):
    r = api_call("/api/login", {"username": user, "password": password, "client": "app"})
    return r.get("token"), (r.get("user") or {}).get("id")


def server_reports():
    token, _ = login_token("admin", args.admin_password)
    return api_call("/api/admin/errors", token=token).get("errors", [])


def wait_report(text, timeout=30):
    end = time.time() + timeout
    while time.time() < end:
        try:
            for e in server_reports():
                if text in (e.get("message") or ""):
                    return e
        except Exception as err:  # noqa: BLE001
            log(f"  (chưa đọc được báo lỗi: {err})")
        time.sleep(2)
    return None


def open_link(url):
    sh(f"am start -a android.intent.action.VIEW -d {url} {PKG}")
    time.sleep(2)


# ---------- các bước kiểm tra ----------

def step(name, fn):
    log(f"\n=== {name}")
    note = ""
    ok = True
    try:
        note = fn() or ""
    except Exception as e:  # noqa: BLE001 — ghi lại lỗi rồi làm tiếp các bước khác
        ok = False
        note = str(e)
    time.sleep(1)
    if not alive():
        ok = False
        note = (note + " — " if note else "") + "APP ĐÃ BỊ TẮT (crash)"
    img = shot(re.sub(r"[^a-z0-9]+", "-", name.lower())[:40])
    results.append((name, ok, note, img))
    log(("OK   " if ok else "LỖI  ") + name + (f" — {note}" if note else ""))
    if not alive():
        # Mở lại để kiểm tra tiếp các phần còn lại
        dismiss_system_dialogs()
        launch()
    else:
        dismiss_system_dialogs()
    return ok


def s_launch():
    n = wait_for(r"^Đăng nhập$", 90)
    if n is None:
        raise RuntimeError("Không thấy màn đăng nhập sau 90 giây")


def s_offline_blocks():
    tap(r"^Chơi Xếp Khối")
    if wait_for(r"^Điểm \d+", 20) is None:
        raise RuntimeError("Không mở được game Xếp Khối")
    time.sleep(2)
    return play_one_block()


def s_back_to_login():
    back()
    if wait_for(r"^Đăng nhập$", 15) is None:
        raise RuntimeError("Bấm Quay lại không về màn đăng nhập")


def s_login():
    root = dump()
    fields = [n for n in nodes(root) if n.get("class") == "android.widget.EditText"]
    if len(fields) < 2:
        raise RuntimeError(f"Chỉ thấy {len(fields)} ô nhập")
    tap_xy(*center(fields[0]))
    type_text(args.user)
    # Bàn phím hiện lên làm màn hình dịch chuyển: ẩn bàn phím rồi tìm lại ô mật khẩu
    hide_keyboard()
    fields = [n for n in nodes(dump()) if n.get("class") == "android.widget.EditText"]
    if len(fields) < 2:
        raise RuntimeError("Không thấy ô mật khẩu")
    tap_xy(*center(fields[1]))
    type_text(args.password)
    hide_keyboard()
    tap(r"^Đăng nhập$")
    if wait_for(r"^Tin nhắn", 45) is None:
        raise RuntimeError("Đăng nhập xong không thấy danh sách tin nhắn")


def s_chat():
    tap(r"^Bạn Bè($|[,.])")  # cuộc trò chuyện riêng (không nhầm với dòng "Bạn Bè: …" của phòng chung)
    if wait_for(r"Tối nay chơi cờ không", 20) is None:
        raise RuntimeError("Không thấy tin nhắn cũ trong cuộc trò chuyện")
    box = wait_for(r"Nhập tin nhắn", 10)
    if box is None:
        raise RuntimeError("Không thấy ô nhập tin nhắn")
    tap_xy(*center(box))
    type_text("apkcheck1")  # chữ không có trong từ điển (bàn phím không tự sửa)
    tap(r"^Gửi$")
    if wait_for(r"apkcheck1", 15) is None:
        raise RuntimeError("Gửi tin nhắn không hiện lên")


def s_chat_back():
    hide_keyboard()
    back()
    if wait_for(r"^Trò chơi", 10) is None:
        raise RuntimeError("Không về được danh sách tin nhắn")


def s_games_hub():
    tap(r"^Trò chơi")
    if wait_for(r"Xếp Khối", 15) is None:
        raise RuntimeError("Không thấy mục Trò chơi")


def s_chess_bot():
    tap(r"^Cờ vua")
    tap(r"^Chơi với máy", 20)
    tap(r"ELO", 15)
    tap(r"^Bắt đầu$", 10)
    if wait_for(r"^e2, Tốt trắng", 30) is None:
        raise RuntimeError("Không mở được bàn cờ")
    time.sleep(2)
    tap(r"^e2,")
    tap(r"^e4")
    time.sleep(8)  # chờ máy đi (có tiếng quân cờ)
    root = dump()
    moved = find(r"^e4, Tốt trắng", root)
    if moved is None:
        raise RuntimeError("Đi e2-e4 nhưng quân không tới e4")


def s_chess_back():
    back()
    time.sleep(1)
    n = find(r"^(Rời ván|Thoát|Ở lại)")
    if n is not None:
        tap(r"^(Rời ván|Thoát)")
    back()
    if wait_for(r"Xếp Khối", 15) is None:
        # Có thể đang ở trang Cờ vua: bấm quay lại lần nữa
        back()
        if wait_for(r"Xếp Khối", 10) is None:
            raise RuntimeError("Không về được mục Trò chơi")


def s_blocks():
    tap(r"^Xếp Khối")
    if wait_for(r"^Điểm \d+", 20) is None:
        raise RuntimeError("Không mở được Xếp Khối")
    time.sleep(2)
    return play_one_block()


def s_blocks_back():
    back()
    if wait_for(r"^Trò chơi", 15) is None:
        raise RuntimeError("Không thoát được Xếp Khối")


def s_background():
    sh("input keyevent 3")  # nút Home
    time.sleep(4)
    launch()
    time.sleep(3)
    if not alive():
        raise RuntimeError("Mở lại từ nền thì app không chạy")


def s_profile():
    tap(r"^Cá nhân")
    if wait_for(r"Người Thử", 15) is None:
        raise RuntimeError("Không thấy trang cá nhân")


def s_feed_and_scroll():
    for _ in range(3):
        sh("input swipe 540 1500 540 600 400")
        time.sleep(1)


def s_report_render_error():
    open_link("thinkbeta://test-render-error")
    if wait_for(r"^Có lỗi xảy ra$", 20) is None:
        raise RuntimeError("Không thấy màn hình 'Có lỗi xảy ra'")
    shot("man-hinh-loi")
    tap(r"^Thử lại$")
    if wait_for(r"^Cá nhân|^Tin nhắn|^Đăng nhập$", 20) is None:
        raise RuntimeError("Bấm Thử lại không về app")
    e = wait_report("lỗi màn hình thử")
    if e is None:
        raise RuntimeError("Máy chủ không nhận được báo lỗi màn hình")
    return f"máy chủ đã nhận: {e['device']} / {e['osVersion']}"


def s_report_crash():
    open_link("thinkbeta://test-crash")
    for _ in range(15):
        if not alive():
            break
        time.sleep(1)
    if alive():
        raise RuntimeError("App không tắt khi crash thử")
    dismiss_system_dialogs()
    e = wait_report("crash thử", 25)
    launch()
    if wait_for(r"^Tin nhắn|^Cá nhân|^Đăng nhập$", 60) is None:
        raise RuntimeError("Mở lại sau crash không được")
    if e is None:
        raise RuntimeError("Máy chủ không nhận được báo crash")
    return f"máy chủ đã nhận crash: {e['message'][:80]} ({e['appVersion']})"


def s_rotate_like_resume():
    # Tắt / bật màn hình (giống khóa máy rồi mở)
    sh("input keyevent 26")
    time.sleep(2)
    sh("input keyevent 26")
    time.sleep(1)
    sh("input keyevent 82")
    time.sleep(2)


# ---------- bong bóng chat ----------

BUBBLE_TEXT = "apkbubble1"
BUBBLE_REPLY = "apkreply1"
bubble = {}


def dm_with_tester():
    """Cuộc trò chuyện riêng giữa Bạn Bè và Người Thử (token của Bạn Bè, mã cuộc trò chuyện)"""
    if "conv" not in bubble:
        _, tester_id = login_token(args.user, args.password)
        token, _ = login_token("ban", "ban12345")
        dm = api_call("/api/conversations/dm", {"userId": tester_id}, token=token)
        bubble.update(token=token, conv=(dm.get("conversation") or dm)["id"])
    return bubble["token"], bubble["conv"]


def head_frame():
    """Vị trí bong bóng trên màn hình (đọc từ danh sách cửa sổ của Android), None nếu không có"""
    lines = sh("dumpsys window windows", timeout=40).splitlines()
    for i, ln in enumerate(lines):
        if "ThinkChatHead}" in ln or ("ThinkChatHead" in ln and "Window{" in ln and "Close" not in ln and "Preview" not in ln):
            if "ThinkChatHeadClose" in ln:
                continue
            for nxt in lines[i + 1:i + 60]:
                m = re.search(r"(?:mFrame=|\bframe=)\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]", nxt)
                if m:
                    x1, y1, x2, y2 = map(int, m.groups())
                    if x2 > x1 and y2 > y1:
                        return x1, y1, x2, y2
    return None


def wait_head(present=True, timeout=20):
    end = time.time() + timeout
    while time.time() < end:
        f = head_frame()
        if (f is not None) == present:
            return f if present else True
        time.sleep(1)
    return None


def resumed_activity():
    out = sh("dumpsys activity activities | grep -E 'mResumedActivity|topResumedActivity|ResumedActivity'")
    return out


def s_bubble_enable():
    sh(f"appops set {PKG} SYSTEM_ALERT_WINDOW allow")
    open_link("thinkbeta://test-bubbles")
    time.sleep(3)
    for _ in range(10):
        if "ChatHeadService" in sh(f"dumpsys activity services {PKG}"):
            return "dịch vụ bong bóng chat đang chạy"
        time.sleep(1)
    raise RuntimeError("Bật bong bóng chat nhưng dịch vụ không chạy")


def s_bubble_head():
    sh("input keyevent 3")  # về màn hình chính của máy
    time.sleep(3)
    token, conv = dm_with_tester()
    api_call(f"/api/conversations/{conv}/messages", {"text": BUBBLE_TEXT}, token=token)
    f = wait_head(True, 25)
    if not f:
        raise RuntimeError("Có tin mới khi app chạy nền nhưng không thấy bong bóng")
    bubble["frame"] = f
    return f"bong bóng ở {f}"


def s_bubble_open():
    f = head_frame() or bubble.get("frame")
    if not f:
        raise RuntimeError("Không có bong bóng để chạm")
    tap_xy((f[0] + f[2]) // 2, (f[1] + f[3]) // 2)
    time.sleep(2)
    if wait_for(BUBBLE_TEXT, 25) is None:
        raise RuntimeError("Chạm bong bóng nhưng khung chat không hiện tin mới")
    if wait_for(r"Nhập tin nhắn", 10) is None:
        raise RuntimeError("Khung chat nổi không có ô nhập tin")
    top = resumed_activity()
    if "BubbleActivity" not in top:
        raise RuntimeError(f"Không phải khung chat nổi: {top.strip()[:200]}")


def s_bubble_reply():
    box = wait_for(r"Nhập tin nhắn", 10)
    tap_xy(*center(box))
    type_text(BUBBLE_REPLY)
    tap(r"^Gửi$")
    token, conv = dm_with_tester()
    end = time.time() + 20
    while time.time() < end:
        msgs = api_call(f"/api/conversations/{conv}/messages", token=token).get("messages", [])
        if any(m.get("text") == BUBBLE_REPLY for m in msgs):
            return "máy chủ đã nhận tin trả lời từ khung chat nổi"
        time.sleep(1.5)
    raise RuntimeError("Gửi trong khung chat nổi nhưng máy chủ không nhận được")


def s_bubble_minimize():
    hide_keyboard()
    back()
    time.sleep(1.5)
    if "BubbleActivity" in resumed_activity():
        raise RuntimeError("Bấm Quay lại không thu nhỏ khung chat")
    if not wait_head(True, 8):
        raise RuntimeError("Thu nhỏ xong bong bóng biến mất")
    return "đã thu nhỏ, bong bóng vẫn còn"


def s_bubble_dismiss():
    f = head_frame()
    if not f:
        raise RuntimeError("Không thấy bong bóng để kéo")
    size = re.findall(r"(\d+)x(\d+)", sh("wm size"))
    w, h = map(int, size[-1]) if size else (1080, 2400)
    dens = re.findall(r"(\d+)", sh("wm density"))
    dpi = int(dens[-1]) if dens else 420
    target_y = h - int(96 * dpi / 160)
    sh(f"input swipe {(f[0] + f[2]) // 2} {(f[1] + f[3]) // 2} {w // 2} {target_y} 1500")
    if not wait_head(False, 8):
        raise RuntimeError("Kéo bong bóng vào dấu ✕ nhưng bong bóng không ẩn")
    return "đã ẩn bong bóng"


def s_bubble_app_after():
    launch()
    if wait_for(r"^Tin nhắn", 30) is None:
        raise RuntimeError("Mở lại app sau khi dùng bong bóng không được")
    tap(r"^Bạn Bè($|[,.])")
    if wait_for(BUBBLE_REPLY, 20) is None:
        raise RuntimeError("Tin trả lời từ bong bóng không có trong app")
    if wait_head(False, 3) is not True:
        raise RuntimeError("App đang mở mà bong bóng vẫn hiện")
    hide_keyboard()
    back()


# ---------- chạy ----------

def main():
    log(f"Máy ảo: {sh('getprop ro.build.version.release').strip()} (API {sh('getprop ro.build.version.sdk').strip()}), {sh('getprop ro.product.model').strip()}")
    log(adb("install", "-r", "-g", args.apk, timeout=240))
    sdk = int(re.sub(r"\D", "", sh("getprop ro.build.version.sdk")) or 0)
    if sdk >= 33:
        sh(f"pm grant {PKG} android.permission.POST_NOTIFICATIONS")
    sh("settings put global window_animation_scale 0")
    sh("settings put global transition_animation_scale 0")
    sh("settings put global animator_duration_scale 0")
    adb("logcat", "-c")
    logcat = open(os.path.join(OUT, "logcat.txt"), "w")
    lc = subprocess.Popen(["adb", "logcat", "-v", "threadtime"], stdout=logcat, stderr=subprocess.STDOUT)
    launch()
    try:
        step("Mở app", s_launch)
        step("Xếp Khối khi chưa đăng nhập", s_offline_blocks)
        step("Quay lại màn đăng nhập", s_back_to_login)
        step("Đăng nhập", s_login)
        step("Nhắn tin", s_chat)
        step("Rời cuộc trò chuyện", s_chat_back)
        step("Mục Trò chơi", s_games_hub)
        step("Cờ vua với máy (có âm thanh)", s_chess_bot)
        step("Rời ván cờ", s_chess_back)
        step("Xếp Khối (có âm thanh)", s_blocks)
        step("Thoát Xếp Khối", s_blocks_back)
        step("Chạy nền rồi mở lại", s_background)
        step("Trang cá nhân", s_profile)
        step("Cuộn bảng tin", s_feed_and_scroll)
        step("Tắt và bật màn hình", s_rotate_like_resume)
        if args.bubble_checks:
            step("Bong bóng chat: bật", s_bubble_enable)
            step("Bong bóng chat: có tin mới khi app chạy nền", s_bubble_head)
            step("Bong bóng chat: chạm để mở khung chat", s_bubble_open)
            step("Bong bóng chat: trả lời trong khung chat", s_bubble_reply)
            step("Bong bóng chat: thu nhỏ", s_bubble_minimize)
            step("Bong bóng chat: kéo vào ✕ để ẩn", s_bubble_dismiss)
            step("Bong bóng chat: mở lại app", s_bubble_app_after)
        if args.report_checks:
            step("Báo lỗi: màn hình bị lỗi", s_report_render_error)
            step("Báo lỗi: app crash", s_report_crash)
        time.sleep(3)
        if not alive():
            results.append(("Cuối cùng", False, "APP ĐÃ BỊ TẮT (crash)", shot("cuoi")))
    finally:
        time.sleep(2)
        lc.terminate()
        logcat.close()
    crashes = find_crashes(os.path.join(OUT, "logcat.txt"))
    write_report(crashes, sdk)
    failed = [r for r in results if not r[1]]
    fatal = [c for c in crashes if c[0] in FATAL_KINDS]
    return 1 if fatal or failed else 0


FATAL_KINDS = ("Java crash", "Native crash", "ANR (app treo)")


def find_crashes(path):
    """Các đoạn lỗi của app trong logcat: Java crash, native crash, ANR (nặng) và lỗi JS / React Native (nhẹ)"""
    lines = open(path, encoding="utf-8", errors="replace").read().splitlines()

    def pid_of(ln):
        f = ln.split()
        return f[2] if len(f) > 3 and f[2].isdigit() else None

    def tag_of(ln):
        m = re.match(r"^\S+ \S+\s+\d+\s+\d+ \w ([^:]*):", ln)
        return m.group(1).strip() if m else None

    out = []
    i = 0
    while i < len(lines):
        ln = lines[i]
        pid = pid_of(ln)
        mine = pid in app_pids
        kind = None
        if "FATAL EXCEPTION" in ln and " AndroidRuntime" in ln:
            kind = "Java crash"
        elif "Fatal signal" in ln and mine:
            kind = "Native crash"
        elif "ANR in " + PKG in ln:
            kind = "ANR (app treo)"
        elif mine and re.search(r" E ReactNativeJS", ln):
            kind = "Lỗi JavaScript"
        elif mine and re.search(r" [EF] (unknown:ReactNative|ReactNative[A-Za-z]*|ExpoModulesCore|ExpoAudio|Expo[A-Za-z]*|ExoPlayer[A-Za-z]*|AudioTrack)\s*:", ln):
            kind = "Lỗi React Native / Expo"
        if kind:
            block = [ln]
            j = i + 1
            while j < len(lines) and len(block) < 80:
                nxt = lines[j]
                if kind == "Java crash" and " AndroidRuntime" not in nxt:
                    break
                if kind == "Native crash" and not re.search(r" (DEBUG|libc|crash_dump\d*|tombstoned)\s*:", nxt) and pid_of(nxt) != pid:
                    break
                if kind == "ANR (app treo)" and " ActivityManager" not in nxt:
                    break
                if kind in ("Lỗi JavaScript", "Lỗi React Native / Expo") and (pid_of(nxt) != pid or tag_of(nxt) != tag_of(ln)):
                    break
                block.append(nxt)
                j += 1
            text = "\n".join(block)
            if TEST_CRASH in text or "lỗi màn hình thử" in text:
                pass  # lỗi cố ý của bước kiểm tra báo lỗi
            elif kind != "Java crash" or PKG in text:
                out.append((kind, text))
            i = j
        else:
            i += 1
    seen = set()
    uniq = []
    for k, b in out:
        key = (k, re.sub(r"^\S+ \S+\s+\d+\s+\d+ ", "", b.splitlines()[0])[:200])
        if key not in seen:
            seen.add(key)
            uniq.append((k, b))
    uniq.sort(key=lambda x: x[0] not in FATAL_KINDS)
    return uniq


def write_report(crashes, sdk):
    label = args.label or f"API {sdk}"
    fatal = [c for c in crashes if c[0] in FATAL_KINDS]
    ok_all = not fatal and all(r[1] for r in results)
    md = [f"### {'✅' if ok_all else '❌'} {label}", ""]
    md.append("| Bước | Kết quả | Ghi chú | Ảnh |")
    md.append("|---|---|---|---|")
    for name, ok, note, img in results:
        md.append(f"| {name} | {'✅' if ok else '❌'} | {note.replace('|', '/')} | {img} |")
    md.append("")
    if crashes:
        md.append(f"**Lỗi tìm thấy trong logcat: {len(fatal)} lỗi nặng (crash / treo), {len(crashes) - len(fatal)} lỗi nhẹ.**")
        md.append("")
        for kind, block in crashes[:12]:
            md.append(f"<details><summary>{kind}: {block.splitlines()[0][-160:]}</summary>")
            md.append("")
            md.append("```")
            md.append(block)
            md.append("```")
            md.append("</details>")
            md.append("")
    else:
        md.append("Không thấy lỗi crash nào trong logcat.")
    # Chú thích lỗi hiện ngay trên trang GitHub Actions
    for name, ok, note, img in results:
        if not ok:
            print(f"::error title={label}: {name}::{note}", flush=True)
    for kind, block in crashes[:5]:
        first = next((l for l in block.splitlines() if "Exception" in l or "Error" in l), block.splitlines()[0])
        print(f"::{'error' if kind in FATAL_KINDS else 'warning'} title={label}: {kind}::{first[-300:]}", flush=True)
    with open(os.path.join(OUT, "report.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(md) + "\n")
    with open(os.path.join(OUT, "result.json"), "w", encoding="utf-8") as f:
        json.dump({"label": label, "ok": ok_all, "steps": results, "crashes": [{"kind": k, "log": b} for k, b in crashes]}, f, ensure_ascii=False, indent=1)
    log("\n".join(md))


if __name__ == "__main__":
    sys.exit(main())
