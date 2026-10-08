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

## Khóa cuộc trò chuyện, ảnh nhóm

- Khóa bằng mật khẩu là riêng từng người (`members.lock_hash`, `src/chat-lock.js`). Theo ý chủ dự án: thông báo (đẩy, trong app) và bong bóng chat vẫn **đầy đủ**; chỉ khi mở cuộc trò chuyện mới hỏi mật khẩu, và danh sách cuộc trò chuyện không hiện nội dung tin. Chỗ mở khung chat (web `openConversation` / `isGated` trong `public/app.js`; app `ChatScreen` → `ChatLockGate`, `native/src/chatLock.ts`) phải giữ màn khóa, kể cả khung chat nổi của bong bóng.
- Ảnh nhóm ở `conversations.avatar` (file trong `uploads/avatars/`, tên bắt đầu bằng `g<mã nhóm>-`); nhóm bị xóa thì xóa luôn ảnh.
- Đổi tên / ảnh (2.15.0, `editableRoom` trong `server.js`): nhóm riêng thì thành viên nào cũng được, phòng chung (`type = 'general'`) thì chỉ admin. Web `canEditRoom` (`public/app.js`), app `editable` (`ConvSettingsSheet.tsx`, `GroupInfoSheet.tsx`) phải cùng luật. Phòng chung có ảnh thì vẽ như ảnh nhóm (`fillConvAvatar`, `ConvAvatar`), chưa có thì biểu tượng nhóm.

## Think AI, gọi thoại / gọi video (2.10.0)

- Think AI là một tài khoản `role = 'bot'` (`src/ai.js`, tạo khi máy chủ khởi động, `password_hash = '!'` nên không đăng nhập được). Mọi chỗ liệt kê người dùng (chọn người nhắn tin, tạo / thêm nhóm, thách cờ, giải đấu, thành viên phòng chung, danh sách admin) phải lọc `u.bot` (máy chủ: `role <> 'bot'`). Gợi ý @nhắc tên thì thêm Think AI lên đầu. `bootstrapAdmin` đếm người dùng **không tính** bot.
- Khóa API AI chỉ nằm ở `settings('ai')` hoặc biến môi trường; API admin chỉ trả `keyHint`. Không bao giờ trả khóa về máy người dùng, không đưa vào log.
- Tóm tắt / dịch (2.14.0): `POST /api/ai/summary`, `POST /api/ai/translate` trả kết quả cho riêng người hỏi, **không** lưu thành tin nhắn. Web: `aiSum` / `translations` trong `public/app.js`; app: `native/src/ai/` (help.ts, AiSummaryBar.tsx, TranslationBox.tsx) — chữ phải giống nhau. Gợi ý tóm tắt lấy `unread` / `lastReadId` lúc mở cuộc trò chuyện, **trước** khi đánh dấu đã đọc (`offerSummary`). Nút tự ẩn khi `aiReady` (từ `GET /api/users`, sự kiện `ai:status`) là false.
- `fixBaseUrl` trong `src/ai.js` sửa địa chỉ API dán nhầm; máy chủ AI trả về HTML thì báo lỗi `url` ("Địa chỉ API không đúng…"), đừng báo chung chung "không trả lời gì".
- Dịch vụ AI (`PROVIDERS` trong `src/ai.js`): `gemini`, `cerebras` (2.12.0, kiểu OpenAI ở `https://api.cerebras.ai/v1`, gửi thêm `reasoning_effort: 'low'` cho model gpt-oss / qwen), `openai`. Model gợi ý cho admin có hai bản giống nhau: `AI_MODELS` trong `public/app.js` và `native/src/screens/AdminScreen.tsx`. Dịch vụ báo lỗi 400 / 422 thì hỏi lại bản đơn giản (bỏ ảnh, tra Google, tham số suy nghĩ).
- Cuộc gọi: máy chủ chỉ chuyển lời (`src/calls.js`, Socket.IO), không xử lý tiếng / hình. Web `public/calls-ui.js` và app `native/src/calls/engine.ts` làm giống nhau (người gọi tạo offer sau `call:accepted`, người nghe tạo answer; ICE đến trước SDP thì xếp hàng). Đổi luồng một bên thì sửa cả bên kia, chạy lại kịch bản gọi chéo web ↔ app.
- App: `native/src/calls/rtc.tsx` dùng `react-native-webrtc` (giữ đúng bản tương thích Expo 54: `react-native-webrtc` 124.0.x + `@config-plugins/react-native-webrtc` 13.0.0); `rtc.web.tsx` là bản cho trình duyệt (chạy thử app bằng `expo export --platform web`). Loa, chế độ gọi, dịch vụ chạy nền ở `CallAudio.kt`, `CallService.kt` (dịch vụ loại microphone để nói được khi app ở nền).
- Tin hệ thống cuộc gọi `{ event: 'call', video, status, duration, to }`: chữ hiển thị ở `callText` (web) và `native/src/format.ts` phải giống nhau.

## Gọi nhóm, máy chủ TURN (2.11.0)

- Gọi nhóm kiểu mesh (mỗi máy nối thẳng với từng người, tối đa `MAX_GROUP` = 8). Luật: **người mới vào gửi offer** cho từng người đang trong cuộc gọi (danh sách trong kết quả `gcall:join` / `gcall:start`), người cũ chỉ trả answer. Offer đến khi đang dở (signalingState khác `stable`, hai bên cùng gửi) thì đóng kết nối cũ, tạo lại rồi trả answer. Web (`public/calls-ui.js`) và app (`native/src/calls/engine.ts`) phải làm giống nhau.
- Sự kiện nhóm: `gcall:start` (nhóm đang có cuộc gọi thì vào luôn, trả `joined: true`), `gcall:join`, `gcall:decline`, `gcall:leave`, `gcall:signal { callId, to, data }` (máy chủ gửi đi `{ callId, from, data }`), `gcall:media`, `gcall:rejoin`; máy chủ phát `gcall:ring`, `gcall:ring-stop`, `gcall:joined`, `gcall:left`, `gcall:update`, `gcall:state` (thanh "Tham gia" và biểu tượng 📞 trong danh sách), `gcall:ended`. Tin hệ thống `{ event: 'gcall', video, status: 'ended' | 'missed', duration, count }` (người gửi = người bắt đầu gọi): chữ ở `groupCallText` (web) và `native/src/format.ts` phải giống nhau.
- Máy chủ TURN ở `src/turn.js`: TURN riêng / link Metered / Cloudflare (Quản trị hoặc biến môi trường); chưa có gì thì dùng Open Relay dùng chung (mật khẩu tạm HMAC). Mật khẩu, token, link có apiKey không bao giờ trả về máy người dùng qua API admin (chỉ `hasCredential`, `meteredHost`…); máy người dùng chỉ nhận danh sách `iceServers` khi gọi. Thiếu TURN là lý do cuộc gọi kẹt ở "Đang kết nối…" khi dùng 4G.
- Mỗi lần nối, máy gửi `call:report` (nối được chưa, đi thẳng / qua TURN, loại đường đã thử). Máy chủ giữ 40 lần gần nhất trong bộ nhớ, hiện ở Quản trị → AI, gọi → "Cuộc gọi gần đây" (web và app, `native/src/screens/TurnSettings.tsx`).
- App giữ kết nối Socket.IO khi chạy nền **nếu đang trong cuộc gọi** (`inCall()` trong `native/src/store.ts`); đừng bỏ điều kiện này (bản 0.11 ngắt kết nối khi chạy nền làm cuộc gọi mất tín hiệu).
- Kiểm tra APK: bước "Gọi nhóm: tham gia, rời" trong `scripts/apk-check/run.py` (Bạn Bè gọi nhóm qua python-socketio, app bấm Tham gia phải gửi offer có `m=audio`).

## Tin 24 giờ (2.13.0)

- Máy chủ `src/stories.js`; web `public/stories-ui.js`; app `native/src/stories/`. Màu nền tin chữ có ba bản phải giống nhau: `STORY_BGS` (máy chủ, chỉ mã), `BGS` trong `public/stories-ui.js`, `STORY_BGS` trong `native/src/stories/bgs.ts` (kiểm thử app so thứ tự mã).
- Thả cảm xúc / trả lời tin = tin nhắn riêng có cột `messages.story` (JSON ảnh nhỏ của tin); `serializeMessage` thêm `alive`. Chữ khung "Đã trả lời tin của bạn" và chữ xem trước khi thả cảm xúc ở `refEl` / `previewOf` (web) và `StoryRefCard.tsx` / `previewText` trong `native/src/format.ts` phải giống nhau.
- Màn xem tin có thanh tiến độ chạy liên tục: kiểm tra APK qua API (bước "Tin 24 giờ"), và xóa tin ở cuối bước để các bước sau bấm "Bạn Bè" trong danh sách chat không trúng vòng tròn tin.
- `replaceChildren` của trình duyệt biến `null` thành chữ "null": lọc `filter(Boolean)` trước khi truyền.

## Kèo, hẹn giờ gửi tin, công thức toán / hóa (2.16.0)

- Kèo là tin nhắn loại `event` (tên kèo ở `messages.text`, người tạo = người gửi), chi tiết ở `events` / `event_rsvps` (`src/events.js`); `serializeMessage` thêm `event` (`eventData`). Thêm loại tin mới thì nhớ: chữ xem trước (`messageSummary` web, `messageSummary` trong `native/src/format.ts`), thông báo (`notifyMembers`), Think AI (`kind IN (...)` trong `src/ai.js`), tìm tin (`src/chat-plus.js`), menu chạm giữ (Sửa / Chuyển tiếp) ở cả hai bản.
- Tin hệ thống `{ event: 'keo-cancel', title }` và `{ event: 'keo-remind', title, startsAt }`: chữ ở `systemText` / `keoRemindText` (web `public/app.js`) và `native/src/format.ts` phải giống nhau.
- Nhắc kèo và gửi tin hẹn giờ chạy bằng vòng lặp trên máy chủ (`sweep`), gửi trễ khi máy chủ thức dậy (kèo đã bắt đầu thì thôi nhắc). `src/keep-awake.js` giữ máy chủ Render thức khi còn việc trong 3 ngày tới — đừng bỏ, người dùng chạy Render gói Free.
- Tin hẹn giờ gửi bằng `postMessage(convId, senderId, { text, mentions, ai: true })` trong `server.js` (dùng chung với trả lời tin 24 giờ): lưu, phát realtime, thông báo, gọi Think AI như tin thường.
- Chữ giờ hẹn, nút giờ nhanh có hai bản giống hệt: `public/plans-core.js` và `native/src/plans/core.ts` (kiểm thử so khớp). Web `public/plans-ui.js`; app `native/src/plans/`.
- Công thức: `public/formula-core.js` (máy chủ dùng cho thông báo, web) và `native/src/formula/core.ts` phải giống hệt (kiểm thử so khớp `parse`, `toUnicode`, `PAD`, `insert`). Không dùng `\p{...}` trong regex (Hermes); chữ cái viết hẳn ra. Luật tránh đổi nhầm (`^_^`, `T_T`, tên file, link) có kiểm thử ở `test/plans.test.js` — sửa luật thì thêm ví dụ vào đó. Web vẽ `<sup>/<sub>`, app dùng chữ số nhỏ Unicode (`Fx` trong `FormulaText.tsx`; ký tự không có dạng nhỏ thì chữ nhỏ, không dùng View trong Text).

## Tin nhắn thoại, thành tựu

- Tin nhắn thoại: phần dùng chung `public/voice-core.js` và bản app `native/src/voice/core.ts` phải giống hệt (kiểm thử so khớp). Mỗi lúc một trình phát dùng chung (`native/src/voice/player.ts`) — đừng tạo trình phát riêng cho từng tin (Android hết luồng âm thanh).
- Thành tựu tính trên máy chủ (`src/achievements.js`); web và app chỉ vẽ. Game mới nên có thêm một huy hiệu.

## Cờ vua: máy cờ, bàn cờ trong app

- Máy cờ khai báo ở `src/chess-bots.js` (id, ELO, gu, câu nói). Không đổi / bỏ id cũ (ván đang chơi và vương miện lưu theo id). Thêm máy có tính cách: thêm một dòng `style({...})`, gu mới thì thêm cách cộng điểm vào `styleBonus` (`src/chess-worker.js`) và tên vào `STYLES`. `test/chess-bots.test.js` kiểm tra ELO tăng dần, đủ câu nói.
- Ván với máy có `hints` / `takebacks`; đi lại làm ván ít nước hơn nên web và app nhận bản mới theo `takebacks` (`isNewer`), đừng bỏ.
- Bàn phân tích, thống kê, câu nói nhanh ở `src/chess-extra.js`. `POST /api/chess/eval` phải giữ chặn thế cờ hiện tại của ván đang chơi và giới hạn số lần (CPU máy chủ miễn phí). Câu nói nhanh chỉ chọn trong `PHRASES` (không cho gõ tự do).
- Màu bàn cờ: `BOARD_THEMES` có hai bản giống nhau (`public/chess-ui.js`, `native/src/chess/prefs.ts`).
- Giải đấu vòng tròn ở `src/chess-tournaments.js` (bảng xếp hạng tính trên máy chủ). Ván trong giải có `tournament_id`: không hủy được, không xin đi lại được — đổi luật ván thường trong `src/chess.js` thì nhớ giữ ngoại lệ này. Thông báo giải gửi kèm `tournamentId` để app mở thẳng trang giải.
- Đi trước (premove) và đọc PGN có hai bản giống nhau: `premoveTargets` / `movesFromPgn` trong `public/chess-ui.js` và `native/src/chess/premove.ts`, `native/src/chess/pgn.ts`.
- Kiểm thử có máy cờ chạy thật: dừng bằng `engine.stop()` trong `test.after`, ván với máy trong kiểm thử nên cầm Trắng (máy không nghĩ dở khi kiểm thử kết thúc).
- Bàn cờ trong app (`native/src/chess/Board.tsx`): vị trí quân dùng Animated **không** native driver và các quân giữ thứ tự vẽ cố định (`layout.ts`). Đổi lại sẽ làm quân hiện sai ô với kiến trúc mới (lỗi phong cấp bản 0.6).

## Kiểm tra trước khi push

- Máy chủ + web: `npm test`.
- App: trong `native/`: `npm run check && npm run lint && npm test && npm run check:native`; định dạng bằng prettier `--print-width 160`.
- Đổi gì trong `native/` thì GitHub Actions build APK (`android-app.yml`) và chạy thử trên máy ảo Android 10 / 14 (`apk-check.yml`, kịch bản `scripts/apk-check/run.py`). Màn hình có đồng hồ đếm từng giây làm uiautomator không đọc được: kiểm tra qua API thay vì đọc màn hình.
- Phiên bản: `package.json` (máy chủ / web) và `native/package.json` (app), nhớ sửa cả `package-lock.json`.
