# Think — ghi chú cho người (và AI) sửa code

- Chủ dự án chỉ dùng điện thoại và đọc tiếng Việt: trả lời, ghi chú, chữ trong app, README đều viết tiếng Việt dễ hiểu. Commit message viết ASCII (tiếng Anh).
- Hai giao diện dùng chung một máy chủ: web PWA trong `public/` và App Think Beta (Expo / React Native) trong `native/`. Tính năng mới làm cho cả hai, cùng dữ liệu, cùng chữ.
- Máy chủ giữ luật và dữ liệu (`server.js`, `src/`); web và app chỉ hiển thị, không tin số liệu gửi từ máy người dùng.

## Bí mật — không bao giờ commit

Repo công khai. Không đưa vào git: khóa ký app (`*.jks`, `password.txt`, `github-secret.txt`), `google-services.json`, tài khoản dịch vụ Firebase, file cấu hình có mã bí mật. Khóa ký chỉ nằm trong GitHub Secrets (`THINK_SIGNING_KEY`). Không hỏi hay gửi mật khẩu / mã truy cập trong cuộc trò chuyện.

## Game mới: bắt buộc có chuỗi hằng ngày

Mọi game trên trang Trò chơi phải có chuỗi ngày chơi liên tiếp (README mục 21). Khi thêm game:

1. Thêm vào `GAMES` trong `src/streaks.js`; cùng mã với `GAME_IDS` trong `public/games-ui.js` và `native/src/games/registry.ts`.
2. Game chạy trên máy chủ: `streaks.record(userId, '<mã>')` mỗi khi người chơi thật sự chơi. Game chạy trên máy (chơi được khi mất mạng): `client: true`, web gọi `ThinkStreaks.mark('<mã>', uid)`, app gọi `markPlayed("<mã>")`.
3. Thêm huy hiệu chuỗi vào đầu màn hình game: web `ThinkStreaks.instance.badge('<mã>')`, app `<StreakBadge game="<mã>" />`.

`test/streaks.test.js` (chạy bằng `npm test`) báo lỗi nếu thiếu bước 1 hoặc 2.

`public/streaks.js` được service worker phục vụ kiểu cache-first (để `blocks.html` chơi được khi máy chủ ngủ), nên lần mở đầu tiên sau khi deploy có thể vẫn chạy bản cũ: chỉ thêm hàm mới, đừng đổi tên hay bỏ hàm cũ của `ThinkStreaks`.

## Câu đố (Quiz hằng ngày + Thử thách nhanh)

Dữ liệu ở `public/puzzles/<game>.json` và bản giống hệt `native/src/puzzles/data/<game>.json` (kiểm thử so khớp). Chỉ tạo bằng `scripts/puzzles/<game>.js`; thêm màn bằng `--add N` (chỉ thêm vào cuối, không sửa màn cũ — tiến độ người chơi tính theo số màn). Luật câu đố có hai bản giống hệt: `public/puzzles-core.js` và `native/src/puzzles/core.ts` — sửa một bên thì sửa cả bên kia.

## Tin nhắn thoại, thành tựu

- Tin nhắn thoại: phần dùng chung `public/voice-core.js` và bản app `native/src/voice/core.ts` phải giống hệt (kiểm thử so khớp). Mỗi lúc một trình phát dùng chung (`native/src/voice/player.ts`) — đừng tạo trình phát riêng cho từng tin (Android hết luồng âm thanh).
- Thành tựu tính trên máy chủ (`src/achievements.js`); web và app chỉ vẽ. Game mới nên có thêm một huy hiệu.

## Cờ vua: máy cờ, bàn cờ trong app

- Máy cờ khai báo ở `src/chess-bots.js` (id, ELO, gu, câu nói). Không đổi / bỏ id cũ (ván đang chơi và vương miện lưu theo id). Thêm máy có tính cách: thêm một dòng `style({...})`, gu mới thì thêm cách cộng điểm vào `styleBonus` (`src/chess-worker.js`) và tên vào `STYLES`. `test/chess-bots.test.js` kiểm tra ELO tăng dần, đủ câu nói.
- Ván với máy có `hints` / `takebacks`; đi lại làm ván ít nước hơn nên web và app nhận bản mới theo `takebacks` (`isNewer`), đừng bỏ.
- Bàn cờ trong app (`native/src/chess/Board.tsx`): vị trí quân dùng Animated **không** native driver và các quân giữ thứ tự vẽ cố định (`layout.ts`). Đổi lại sẽ làm quân hiện sai ô với kiến trúc mới (lỗi phong cấp bản 0.6).

## Kiểm tra trước khi push

- Máy chủ + web: `npm test`.
- App: trong `native/`: `npm run check && npm run lint && npm test && npm run check:native`; định dạng bằng prettier `--print-width 160`.
- Đổi gì trong `native/` thì GitHub Actions build APK (`android-app.yml`) và chạy thử trên máy ảo Android 10 / 14 (`apk-check.yml`, kịch bản `scripts/apk-check/run.py`). Màn hình có đồng hồ đếm từng giây làm uiautomator không đọc được: kiểm tra qua API thay vì đọc màn hình.
- Phiên bản: `package.json` (máy chủ / web) và `native/package.json` (app), nhớ sửa cả `package-lock.json`.
