#!/usr/bin/env python3
"""Tạo dữ liệu thử cho máy chủ Think chạy trong GitHub Actions (workflow "Kiểm tra APK").

Máy chủ phải chạy với ADMIN_PASSWORD đặt sẵn. Tạo 3 tài khoản:
  tester / tester12345  (app trên máy ảo đăng nhập bằng tài khoản này)
  ban    / ban12345     (gửi tin nhắn, đăng bài, có điểm Xếp Khối, có nông trại để các màn hình có dữ liệu)
  hai    / hai12345     (cùng "ban" mời người thử vào một giải đấu cờ vua)
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request

BASE = os.environ.get("THINK_SERVER", "http://127.0.0.1:3000")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "admin123")


class Api:
    def __init__(self):
        self.cookie = None

    def call(self, path, method="GET", body=None):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(BASE + path, data=data, method=method)
        if body is not None:
            req.add_header("content-type", "application/json")
        if self.cookie:
            req.add_header("cookie", self.cookie)
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                sc = r.headers.get("set-cookie")
                if sc:
                    self.cookie = sc.split(";")[0]
                return json.loads(r.read() or b"{}")
        except urllib.error.HTTPError as e:
            raw = e.read() or b"{}"
            try:
                return {"_status": e.code, **json.loads(raw)}
            except ValueError:
                return {"_status": e.code, "error": raw[:200].decode("utf-8", "replace")}


def wait_server():
    for _ in range(120):
        try:
            urllib.request.urlopen(BASE + "/api/config", timeout=5)
            return
        except Exception:
            time.sleep(1)
    sys.exit("Máy chủ không chạy")


def main():
    wait_server()
    admin = Api()
    r = admin.call("/api/login", "POST", {"username": "admin", "password": ADMIN_PASSWORD})
    if r.get("_status"):
        sys.exit(f"Không đăng nhập được admin: {r}")

    def member(username, name, password):
        u = admin.call("/api/admin/users", "POST", {"username": username, "displayName": name})
        if u.get("_status"):
            sys.exit(f"Không tạo được {username}: {u}")
        a = Api()
        a.call("/api/login", "POST", {"username": username, "password": u["password"]})
        a.call("/api/me/password", "POST", {"newPassword": password})
        a = Api()
        a.call("/api/login", "POST", {"username": username, "password": password})
        return a, u["user"]["id"]

    tester, tester_id = member("tester", "Người Thử", "tester12345")
    ban, ban_id = member("ban", "Bạn Bè", "ban12345")
    hai, hai_id = member("hai", "Bạn Hai", "hai12345")

    dm = ban.call("/api/conversations/dm", "POST", {"userId": tester_id})
    conv = (dm.get("conversation") or dm).get("id")
    for text in ["Chào bạn!", "Tối nay chơi cờ không?", "Nhớ thử game Xếp Khối nhé 😆"]:
        ban.call(f"/api/conversations/{conv}/messages", "POST", {"text": text})
    convs = tester.call("/api/conversations").get("conversations", [])
    for c in convs:
        if c.get("type") == "general":
            ban.call(f"/api/conversations/{c['id']}/messages", "POST", {"text": "Chào cả nhóm, đây là tin nhắn thử."})
    ban.call("/api/posts", "POST", {"text": "Bài đăng thử trên bảng tin 🎉"})
    now = int(time.time() * 1000)
    ban.call("/api/games/blocks/scores", "POST", {"scores": [{"id": "seed-ban-00000001", "score": 1234, "moves": 60, "lines": 20, "durationMs": 300000, "playedAt": now - 60000}]})
    # Nông trại của "ban": có sẵn 2 ô lúa mì chín để người thử ghé vườn
    ban.call("/api/farm")
    # Giải đấu cờ vua: "ban" mời người thử và "hai"; "hai" đã nhận lời, người thử nhận lời trên app thì giải bắt đầu
    t = ban.call("/api/chess/tournaments", "POST", {"name": "Cờ nhà", "players": [tester_id, hai_id], "days": 1, "rounds": 1, "rated": False})
    tid = (t.get("tournament") or {}).get("id")
    if tid:
        hai.call(f"/api/chess/tournaments/{tid}/join", "POST", {})
    out = {"testerId": tester_id, "banId": ban_id, "dm": conv, "tournamentId": tid}
    print(json.dumps(out))


if __name__ == "__main__":
    main()
