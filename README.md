# Think — web chat riêng cho hội bạn

App chat chạy trên web, cài được lên điện thoại như app thật (PWA), có thông báo đẩy kể cả khi đã đóng app.

**Tính năng**

- Tài khoản do admin cấp, không ai tự đăng ký được. Lần đầu đăng nhập bắt buộc đổi mật khẩu tạm.
- Mỗi người tự đổi được: tên hiển thị, mật khẩu, ảnh đại diện.
- Phòng chung cho cả nhóm, nhắn riêng 1-1, và **nhóm chat riêng** tự tạo (đặt tên, thêm/xóa người, rời nhóm, có trưởng nhóm).
- Gửi ảnh (tự nén trên máy trước khi gửi), dán ảnh bằng Ctrl+V trên máy tính.
- Thanh điều hướng dưới cùng: **Tin nhắn**, **Cá nhân** (đổi tên, mật khẩu, ảnh đại diện, thông báo, lưu trên máy) và **Quản trị** (chỉ admin thấy).
- **Lưu trên máy người dùng**: tin nhắn và ảnh được giữ lại trên điện thoại, mở app là xem được ngay kể cả khi mất mạng hay máy chủ đang thức dậy. Tải lịch sử chat thành file, tải ảnh về máy.
- **Bộ nhớ máy chủ**: thanh hiển thị dung lượng đã dùng, **tự dọn ảnh và tin nhắn cũ nhất khi sắp đầy**, dọn thủ công có xem trước.
- **App Android có bong bóng chat** (Android 8 trở lên): tin nhắn mới hiện thành bong bóng nổi như Messenger, chạm vào để trả lời ngay; thông báo có ảnh từng người gửi, ô **Trả lời** và nút **Đã đọc**. Tải app ngay trên web (Cá nhân → Cài app lên máy).
- **App Think Beta** (thư mục `native/`): app thật viết bằng React Native, không phải trang web trong khung. GitHub tự build file APK mỗi lần sửa code (mục 13).
- **Cờ vua** (mục 14): thách đấu bạn bè, chọn thời gian (1+0 … 30+0 hoặc không giới hạn), đồng hồ do máy chủ giữ, **điểm ELO và bảng xếp hạng**, chơi với 8 máy cờ mã nguồn mở (có Stockfish), **xem lại ván**, **Stockfish phân tích ván** (độ chính xác, nước sai lầm), bật/tắt chỉ dẫn, âm thanh quân cờ. Có trên cả web lẫn App Think Beta.
- **Trả lời tin nhắn** (chạm giữ → Trả lời, hoặc vuốt ngang tin nhắn) và **thả cảm xúc** ❤️ 😆 😮 😢 😡 👍, xem được ai đã thả.
- Realtime: đang nhập…, đang hoạt động / hoạt động X phút trước, "Đã xem" (nhóm hiện ảnh người đã xem), thu hồi tin nhắn.
- Thông báo đầy đủ:
  - Thông báo đẩy của hệ thống khi đóng app hoặc tắt màn hình (Android, iPhone iOS 16.4+, máy tính).
  - Gom tin theo cuộc trò chuyện: "Minh (3 tin nhắn)", bấm vào mở đúng cuộc trò chuyện.
  - Số tin chưa đọc trên biểu tượng app và trên tiêu đề tab.
  - Âm báo + thông báo nhỏ trong app khi đang mở.
- Admin: tạo tài khoản, đặt lại mật khẩu, khóa / mở khóa, cấp quyền admin. Khóa ai là người đó bị đăng xuất ngay.
- Màn đăng nhập nền đen chữ trắng; bên trong app tự sáng / tối theo máy. Tìm kiếm không cần gõ dấu.

Chỉ cần Node.js, không cần cài database riêng (dùng SQLite có sẵn trong Node 22.13 trở lên).

---

## 1. Chạy thử trên Termux

```bash
pkg update && pkg install nodejs
node -v            # cần v22.13 trở lên
cd ~/think-chat      # để project trong thư mục home, KHÔNG để trong /sdcard
npm install
npm start
```

Terminal sẽ in ra tài khoản admin đầu tiên:

```
  Tên đăng nhập: admin
  Mật khẩu:      hMKzb7WSKa
```

Mở Chrome trên chính điện thoại đó, vào `http://localhost:3000`. Trên `localhost` thì cài app và thông báo đều chạy được.

> Mở bằng IP mạng LAN (vd `http://192.168.1.5:3000`) thì chat vẫn được nhưng **không cài app và không có thông báo**, vì trình duyệt bắt buộc HTTPS. Muốn bạn bè dùng thử đầy đủ, xem mục 2.

## 2. Cho bạn bè dùng thử ngay từ Termux (HTTPS miễn phí, không cần tên miền)

Chỉ cần một lệnh, chạy web và mở link cùng lúc:

```bash
pkg install cloudflared
termux-wake-lock                       # giữ Termux không bị tắt khi khóa màn hình
npm run share
```

Link hiện trong khung dạng `https://abc-xyz.trycloudflare.com`. Gửi link đó cho bạn bè là dùng được luôn, kể cả cài app và nhận thông báo. Bấm Ctrl + C để tắt cả web lẫn link.

- Web đang chạy sẵn ở phiên khác (bằng `npm start`) thì chỉ cần `npm run tunnel` để mở link.
- Lệnh này dùng giao thức **HTTP/2 (TCP)** thay cho QUIC (UDP). Android và nhiều nhà mạng hay chặn UDP của Termux, gây lỗi `sendmsg: operation not permitted` làm link chết. Tunnel bị tắt thì tự mở lại.
- Nên vào Cài đặt → Ứng dụng → Termux → Pin → chọn **Không hạn chế**, để Android không cắt mạng khi tắt màn hình.

Lưu ý: link này **đổi mỗi lần chạy lại** cloudflared (bạn bè phải cài lại app), và điện thoại phải luôn bật. Chỉ nên dùng để thử. Dùng lâu dài thì lên VPS.

## 3. Deploy lên VPS (chạy 24/7, khuyên dùng)

Cần: VPS Ubuntu 22.04+/Debian 12, và một tên miền trỏ về IP của VPS (bản ghi A).
Chưa có tên miền? Dùng tên miền miễn phí của [DuckDNS](https://www.duckdns.org), hoặc dùng luôn dạng `203-0-113-5.sslip.io` (thay bằng IP VPS của bạn, dấu chấm đổi thành gạch ngang) — không cần đăng ký gì.

**Bước 1: Cài Node.js**

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs
node -v
```

**Bước 2: Đưa code lên và chạy thử**

```bash
git clone https://github.com/<tên-bạn>/think-chat.git   # hoặc tải file zip lên rồi giải nén
cd think-chat
npm install --omit=dev
cp .env.example .env
nano .env                  # sửa APP_NAME, VAPID_SUBJECT (email thật)...
```

Nếu VPS đang chạy app khác ở cổng 3000 (ví dụ bot), đổi `PORT=3100` trong `.env`.

**Bước 3: Chạy nền 24/7 bằng PM2**

```bash
sudo npm install -g pm2
pm2 start server.js --name think-chat
pm2 save
pm2 startup                # chạy tiếp dòng lệnh mà nó in ra để tự bật lại khi VPS khởi động lại
pm2 logs think-chat          # xem mật khẩu admin đầu tiên
```

**Bước 4: Bật HTTPS bằng Caddy** (tự xin và gia hạn chứng chỉ)

```bash
sudo apt install -y caddy
sudo nano /etc/caddy/Caddyfile
```

Thêm khối sau (mẫu có trong `deploy/Caddyfile`), thay tên miền và cổng cho đúng:

```
chat.tenmien.com {
	encode zstd gzip
	reverse_proxy 127.0.0.1:3000
}
```

```bash
sudo systemctl reload caddy
sudo ufw allow 80,443/tcp          # nếu có bật tường lửa ufw
```

Mở `https://chat.tenmien.com` là xong.

- Nếu Caddyfile đã có site khác thì **thêm** khối mới, đừng xóa khối cũ.
- VPS đã dùng Nginx rồi thì đừng cài Caddy (sẽ tranh cổng 80/443). Dùng mẫu `deploy/nginx.conf` rồi chạy `sudo certbot --nginx -d chat.tenmien.com`.
- Muốn bản Caddy mới nhất: xem hướng dẫn cài tại caddyserver.com/docs/install.

## 4. Render miễn phí + Firebase của Google (không cần thẻ)

Gói Free của Render xóa sạch ổ đĩa mỗi lần khởi động lại, ngủ hoặc deploy. Vì vậy Think tự **sao lưu dữ liệu lên Firebase Firestore** (gói Spark miễn phí, không cần thẻ):

- Khởi động: tải database, ảnh, khóa thông báo từ Firestore về.
- Đang chạy: có thay đổi là tự đẩy lên, tối đa 30 giây một lần.
- Render tắt app (ngủ, khởi động lại, deploy): đẩy lần cuối trước khi tắt.

Nhược điểm của gói Free: app **ngủ sau 15 phút** không ai dùng, người mở app đầu tiên phải chờ khoảng 1 phút (app hiện dòng "Máy chủ đang thức dậy"). Lúc app ngủ không có ai gửi tin, nên cũng không lỡ thông báo nào. Nếu máy chủ bị tắt đột ngột (hiếm), có thể mất tin của khoảng 30 giây cuối.

**Bước 1. Tạo Firebase**

1. Vào **console.firebase.google.com** → **Create a project** → đặt tên, vd `think-chat` → tắt Google Analytics → tạo.
2. Menu trái **Build → Firestore Database → Create database**:
   - Database ID để nguyên `(default)`.
   - Location chọn **asia-southeast1 (Singapore)**.
   - Chọn **Start in production mode** → Create.
3. Bấm bánh răng ⚙ → **Project settings → Service accounts → Generate new private key** → tải về một file `.json`. Đây là chìa khóa vào database, **không gửi cho ai và không đưa lên GitHub**.

**Bước 2. Đưa code lên GitHub** (repo **Private**):

```bash
cd ~/think-chat
git init && git add . && git commit -m "Think"
git branch -M main
git remote add origin https://github.com/TEN-BAN/think-chat.git
git push -u origin main
```

**Bước 3. Tạo Web Service trên Render**

New → **Web Service** → chọn repo, rồi điền:

| Mục | Giá trị |
|---|---|
| Region | Singapore |
| Runtime | Node |
| Build Command | `npm install` |
| Start Command | `npm start` |
| Instance Type | **Free** |

Mục **Environment Variables**:

| Tên | Giá trị |
|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | dán **toàn bộ nội dung** file `.json` ở bước 1 |
| `NODE_VERSION` | `24` |
| `APP_NAME` | `Think` |
| `ADMIN_PASSWORD` | mật khẩu admin bạn muốn |
| `VAPID_SUBJECT` | `mailto:email-that-cua-ban@gmail.com` |

Lấy nội dung file `.json` trên điện thoại: mở file bằng một app xem văn bản, chọn tất cả rồi sao chép. Hoặc trên Termux (cần cài app Termux:API): `pkg install termux-api` rồi `termux-clipboard-set < ~/storage/downloads/TEN-FILE.json`.

Bấm **Create Web Service**. Trong tab **Logs**, thấy dòng `Firebase chưa có bản sao lưu nào, bắt đầu với dữ liệu mới` rồi `Think đang chạy` là xong. Link có dạng `https://think-chat.onrender.com`.

- Cập nhật code: `git push` là Render tự deploy lại, dữ liệu vẫn còn (nằm trên Firebase).
- Quên mật khẩu admin: gói Free không có tab Shell. Thêm biến `RESET_ADMIN_PASSWORD` = mật khẩu mới → lưu (Render tự khởi động lại) → đăng nhập được thì **xóa biến đó đi**.
- App Android (mục 7): máy chủ đã tự khai báo app Think, không cần thêm biến nào. Tên miền riêng (vd `thinkchat.id.vn`): thêm ở **Settings → Custom Domains** của Render; đổi tên miền thì phải build lại app (mục 7).
- Hạn mức Firestore miễn phí: 1 GiB dữ liệu, 50.000 lượt đọc, 20.000 lượt ghi mỗi ngày, dư sức cho một nhóm bạn. App tự tính giới hạn 900 MB và tự dọn ảnh cũ khi sắp đầy (mục 12).
- Log báo `Chưa tạo Firestore Database`: làm lại bước 1.2. Báo `Khóa Firebase không hợp lệ`: dán lại đúng nội dung file `.json`.

## 5. Lần đầu sử dụng

1. Đăng nhập bằng tài khoản admin in ra ở log, đặt mật khẩu mới.
2. Bấm tab **Quản trị** ở thanh dưới cùng → mục **Tài khoản** → **Tạo tài khoản mới** cho từng người.
   Để trống ô mật khẩu tạm thì app tự tạo. Bấm **Sao chép** hoặc **Chia sẻ** để gửi thông tin qua Zalo/Messenger.
3. Bạn bè đăng nhập bằng mật khẩu tạm, app bắt đặt mật khẩu riêng rồi mới vào chat.

Muốn đổi tên, ảnh đại diện, mật khẩu: bấm tab **Cá nhân** ở thanh dưới cùng.

## 6. Cài app và bật thông báo

| Thiết bị | Cách cài |
|---|---|
| Android | Mở link bằng Chrome → **Cá nhân → Cài app lên máy → Tải app Android** (có bong bóng chat, xem mục 7) |
| iPhone / iPad (iOS 16.4+) | Mở bằng **Safari** → nút Chia sẻ → **Thêm vào MH chính**, rồi mở app từ màn hình chính |
| Máy tính (Chrome/Edge) | Bấm biểu tượng cài đặt ở cuối thanh địa chỉ |

Sau khi cài, mở app → bấm **Bật thông báo** (dải nhắc ở đầu danh sách, hoặc trong tab **Cá nhân → Thông báo**). Bấm **Gửi thử** để kiểm tra.

Trên iPhone, thông báo **chỉ chạy trong app đã thêm vào màn hình chính**, không chạy trong tab Safari thường.

**App Android có bong bóng chat:** xem mục 7.

## 7. App Think cho Android (bong bóng chat)

App Think cho Android (thư mục `android/`, file cài `public/download/think.apk`) mở web Think toàn màn hình bằng Chrome, giống APK làm bằng PWABuilder, và có thêm:

- **Bong bóng chat** (Android 8 trở lên): tin nhắn mới hiện thành bong bóng nổi trên màn hình như Messenger. Chạm vào bong bóng là mở khung chat nhỏ, đọc và trả lời ngay, không cần mở app.
  - Android 11 trở lên: dùng bong bóng có sẵn của Android.
  - Android 8, 9, 10: app tự vẽ bong bóng đè lên màn hình (cần quyền **Hiển thị trên ứng dụng khác**). Kéo bong bóng đi đâu cũng được, kéo xuống dấu ✕ để ẩn. Trong lúc có bong bóng, Android bắt buộc hiện thêm thông báo nhỏ "Bong bóng chat đang bật".
- Thông báo kiểu hội thoại: tên và ảnh từng người gửi, các tin chưa đọc, ô **Trả lời** gõ ngay trong thông báo, nút **Đã đọc**.
- Tự báo khi có bản app mới.

App vẫn chạy bản web mới nhất trên máy chủ: sửa tính năng rồi `git push` là app trên máy mọi người tự cập nhật. Chỉ cần cài lại app khi đổi tên miền, icon, hoặc có bản app mới.

### Cài app

1. **Máy đang có app Think cũ làm bằng PWABuilder thì gỡ trước** (giữ lâu biểu tượng → Gỡ cài đặt). Hai bản ký bằng khóa khác nhau nên không cài đè được. Tin nhắn và đăng nhập nằm trong Chrome nên không mất.
2. Mở `https://thinkchat.id.vn` bằng **Chrome**, vào **Cá nhân → Cài app lên máy → Tải app Android** (hoặc mở thẳng `https://thinkchat.id.vn/download/think.apk`).
3. Mở file vừa tải. Android hỏi quyền **cài ứng dụng không rõ nguồn gốc**: bấm **Cài đặt**, bật quyền cho Chrome, quay lại rồi bấm **Cài đặt**. Nếu **Play Protect** cảnh báo: **Chi tiết → Vẫn cài đặt** (cảnh báo này hiện với mọi APK không tải từ Google Play).
4. Mở app Think. Lần đầu có thể hiện dòng nhỏ báo app chạy bằng Chrome: bình thường.

### Bật bong bóng chat (mỗi máy làm một lần)

1. Trong app: **Cá nhân → Thông báo → Bật thông báo** (nếu chưa bật).
2. **Cá nhân → Bong bóng chat → Bật bong bóng chat**. App hiện hộp thoại và hướng dẫn tiếp:
   - **Cho phép thông báo** (Android 13+).
   - Android 11 trở lên, **Cho phép bong bóng**: trong trang cài đặt mở ra, chọn **Tất cả cuộc trò chuyện đều có thể hiện bong bóng**. Máy Samsung vào thêm **Cài đặt → Thông báo → Cài đặt nâng cao → Thông báo nổi → Bong bóng**.
   - Android 8, 9, 10, **Cho phép hiển thị trên ứng dụng khác**: bật cho Think rồi bấm quay lại, sau đó bấm **Xem thử** để thấy bong bóng. Máy Xiaomi bật thêm **Hiển thị cửa sổ bật lên khi chạy nền** (Cài đặt → Ứng dụng → Think → Quyền khác).
3. Nhờ ai đó nhắn thử khi bạn đang ở màn hình chính: tin nhắn hiện thành bong bóng.

Bấm "Bật bong bóng chat" là web đưa cho app một mã dùng một lần để app tự đăng nhập cho bong bóng và ô Trả lời (hai phần này không dùng chung đăng nhập với Chrome). Đổi mật khẩu thì phải bấm lại nút này. Android 7 không có bong bóng, nhưng vẫn trả lời được ngay trong thông báo. Muốn tắt bong bóng trên Android 8–10: bấm **Tắt bong bóng** trong thông báo "Bong bóng chat đang bật".

### Kiểm tra khi có trục trặc

- Mở `https://thinkchat.id.vn/.well-known/assetlinks.json`: phải có `com.nuwngc.think` và dãy `EA:58:D7:0C:…:0B:24` (khóa của app Think, máy chủ tự thêm). Dãy của APK PWABuilder cũ trong `ANDROID_SHA256` (nếu có) vẫn giữ được, không ảnh hưởng.
- **Có thanh địa chỉ ở trên cùng** hoặc **đứng mãi ở logo**: kiểm tra dòng trên, cập nhật Chrome, rồi đóng hẳn app và mở lại. Vẫn bị thì vào **Cài đặt → Ứng dụng → Chrome → Bộ nhớ → Xóa bộ nhớ đệm**.
- **Không hiện bong bóng mà chỉ có thông báo thường**: bấm lại "Bật bong bóng chat" để xem bước nào còn thiếu. Kéo thông báo xuống, bấm biểu tượng bong bóng ở góc thông báo cũng bật được cho từng cuộc trò chuyện.
- **Bong bóng hiện màn hình đăng nhập**: chưa liên kết (hoặc vừa đổi mật khẩu). Bấm lại "Bật bong bóng chat" trong app.
- **Máy không có Chrome** (vd Huawei đời mới): app mở bằng trình duyệt khác và không có bong bóng; nếu máy không có trình duyệt nào, app mở web bằng khung riêng nhưng không nhận thông báo đẩy.

### Build lại app (dành cho chủ server)

Chỉ cần khi đổi tên miền (`android/src/com/nuwngc/think/Config.java`), icon, tên app, hoặc sửa phần Android. Không cần Android Studio: chạy trên Ubuntu/Debian (không chạy trên Termux).

```bash
sudo apt install aapt dalvik-exchange zipalign apksigner openjdk-17-jdk-headless
# tăng android:versionCode (2 → 3) và android:versionName trong android/AndroidManifest.xml
export THINK_KEYSTORE=/đường/dẫn/think-release.jks   # khóa ký app, cất riêng, KHÔNG đưa lên GitHub
export THINK_KS_PASS='mật khẩu khóa ký'
export THINK_RELEASE_NOTES='Mô tả ngắn bản mới'
./android/build.sh
git add public/download && git commit -m "App Android bản mới" && git push
```

Script tạo `public/download/think.apk` và `public/download/version.json`. Sau khi deploy, app trên máy mọi người tự báo "Có app Think bản mới", chạm vào để tải và cài đè (không mất dữ liệu).

**Khóa ký (`think-release.jks` + mật khẩu) phải giữ mãi.** Mất khóa thì bản mới không cài đè được, mọi người phải gỡ app rồi cài lại. Khi đổi sang khóa khác, nhớ sửa dãy SHA-256 trong `THINK_APP` ở `server.js` (script in dãy này ra ở cuối).

### Cách khác: tự làm APK bằng PWABuilder

Vẫn dùng được nếu không cần bong bóng chat: pwabuilder.com → dán link → **Package For Stores → Android**, Package ID khác `com.nuwngc.think` (vd `com.nuwngc.think.web`), **Signing key chọn New**, tải zip về, rồi thêm `ANDROID_PACKAGE` / `ANDROID_SHA256` (lấy trong `assetlinks.json` của zip) vào biến môi trường của Render. Máy chủ sẽ gộp khai báo đó với khai báo của app Think.

## 8. Quên mật khẩu admin

Chạy trong thư mục project trên server (không cần tắt app):

```bash
npm run admin -- list                              # xem danh sách tài khoản
npm run admin -- reset-password admin              # tạo mật khẩu ngẫu nhiên (đồng thời mở khóa)
npm run admin -- reset-password admin MatKhauMoi1  # hoặc tự đặt
npm run admin -- make-admin minh                   # cấp quyền admin cho người khác
```

## 9. Sao lưu và cập nhật

Toàn bộ dữ liệu nằm trong thư mục `data/`: database `chat.db`, ảnh trong `uploads/`, khóa thông báo `vapid.json`.

```bash
pm2 stop think-chat && tar czf think-backup-$(date +%F).tar.gz data && pm2 start think-chat
```

Giữ kỹ `vapid.json`: mất file này thì mọi người phải bật lại thông báo.

Cập nhật code mới:

```bash
git pull && npm install --omit=dev && pm2 restart think-chat
```

## 10. Tùy chỉnh (file `.env`)

| Biến | Ý nghĩa | Mặc định |
|---|---|---|
| `PORT` | Cổng chạy app | `3000` |
| `APP_NAME` | Tên app trên màn hình chính | `Think` |
| `GENERAL_ROOM_NAME` | Tên phòng chung (khi tạo database lần đầu) | `Cả nhóm` |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD` | Admin đầu tiên (khi database còn trống) | `admin`, tự tạo |
| `VAPID_SUBJECT` | Email liên hệ cho dịch vụ push | `mailto:admin@example.com` |
| `DATA_DIR` | Thư mục dữ liệu | `./data` |
| `TRUST_PROXY` | Đặt `1` nếu chạy sau proxy ở máy khác | tin proxy cùng máy |
| `ANDROID_PACKAGE`, `ANDROID_SHA256` | Thay cho file `data/assetlinks.json` khi làm APK | trống |
| `FIREBASE_SERVICE_ACCOUNT` | Nội dung file khóa Firebase, bật sao lưu lên Firestore (mục 4) | trống = không dùng |
| `STORAGE_LIMIT_MB` | Giới hạn bộ nhớ máy chủ mặc định (admin vẫn đổi được trong app) | 900 khi có Firebase, còn lại theo ổ đĩa |
| `RESET_ADMIN_PASSWORD` | Đặt lại mật khẩu admin khi khởi động (xóa đi sau khi dùng) | trống |
| `FIREBASE_PREFIX` | Tiền tố tên bảng trên Firestore, đổi nếu chạy nhiều app chung một project | `think` |
| `CORS_ORIGINS` | Chỉ dùng khi chạy thử App Think Beta trên trình duyệt ở địa chỉ khác, vd `http://localhost:8081` | trống |

Màu sắc nằm ở đầu file `public/app.css` (biến `--jade`, `--turmeric`). Icon app nằm trong `public/icons/`.

## 11. Xử lý sự cố

- **Không nhận được thông báo**: app phải mở bằng `https://`. Kiểm tra đã cho phép thông báo chưa, bấm **Gửi thử**. Trên Android, tắt chế độ tối ưu pin cho Chrome. Trên iPhone, phải mở từ màn hình chính.
- **Cứ hiện "Mất kết nối"**: proxy chưa chuyển tiếp WebSocket. Với Nginx phải có 2 dòng `Upgrade` / `Connection` như trong `deploy/nginx.conf`.
- **Lỗi "Không tìm thấy SQLite"**: Node cũ hơn 22.13, cần cập nhật Node.
- **Lỗi database trên Termux**: chuyển project ra khỏi `/sdcard`, để trong thư mục home (`~`).
- **cloudflared báo `failed to dial to edge with quic` hoặc link chết**: dùng `npm run share` / `npm run tunnel` thay cho lệnh cloudflared tự gõ (mục 2). Muốn xem log đầy đủ: `TUNNEL_DEBUG=1 npm run tunnel`.
- **Cổng đã có người dùng (EADDRINUSE)**: đổi `PORT` trong `.env`.
- **Mở app thấy tin nhắn nhưng không gửi được, có dòng "đang xem bản lưu trên máy"**: máy chủ đang thức dậy hoặc mất mạng. App tự kết nối lại sau vài giây, không cần làm gì.
- **App APK có thanh địa chỉ ở trên**: `assetlinks.json` thiếu hoặc sai (mục 7, bước 5). Sửa xong thì xóa dữ liệu Chrome của trang web đó trên điện thoại rồi mở lại app.

## 12. Bộ nhớ máy chủ và lưu trên máy

**Lưu trên máy (mọi người, mặc định bật)**: tab **Cá nhân → Lưu trên máy này**.

- Tin nhắn được lưu trong trình duyệt của điện thoại. Ảnh đã xem, ảnh mình gửi và ảnh mới được giữ trong bộ nhớ đệm.
- Mở app là thấy ngay tin nhắn, kể cả khi **Render đang thức dậy** hoặc **mất mạng**. Kết nối lại được thì app tự đồng bộ.
- Máy chủ dọn tin hoặc ảnh cũ thì bản trên máy **vẫn còn**. Ai chưa lưu sẽ thấy dòng "Ảnh đã được dọn khỏi máy chủ".
- **Tải lịch sử chat**: tải toàn bộ tin đã lưu thành một file `.html`, mở bằng trình duyệt nào cũng đọc được.
- **Tải ảnh về máy**: mở ảnh, bấm nút tải ở góc trên (hoặc chạm giữ ảnh → Tải ảnh về máy). Trên iPhone sẽ mở bảng chia sẻ để lưu vào Ảnh.
- Dữ liệu nằm trong trình duyệt của từng máy. Xóa dữ liệu Chrome hoặc gỡ app là mất. Mỗi tài khoản có kho riêng, người khác đăng nhập trên cùng máy không xem được.
- **Tắt** hoặc **Xóa dữ liệu trên máy**: xóa sạch tin và ảnh đã lưu trên máy đó.

**Bộ nhớ máy chủ (chỉ admin)**: tab **Quản trị → Bộ nhớ máy chủ**.

- Thanh hiển thị phần trăm đã dùng và bảng chia theo loại: ảnh trong tin nhắn, tin nhắn, ảnh đại diện.
- Giới hạn mặc định: **900 MB** khi dùng Firebase (Firestore miễn phí 1 GB), hoặc theo ổ đĩa khi chạy trên VPS/Termux. Đổi được ngay trong trang này.
- **Tự dọn** (mặc định bật): khi đạt **90%**, máy chủ xóa **ảnh cũ nhất trước** (tin nhắn vẫn còn). Chưa đủ thì mới xóa **tin nhắn cũ nhất**, và dừng khi còn **75%**. Hai mức này chỉnh được. Admin đang mở app sẽ nhận thông báo mỗi lần tự dọn.
- **Dọn thủ công**: chọn **Ảnh** hoặc **Tin nhắn**, chọn **Cũ hơn** (7 ngày … 1 năm, hoặc tất cả), bấm **Kiểm tra** để xem sẽ xóa bao nhiêu và giải phóng bao nhiêu, rồi mới bấm **Xóa ngay**.
- Tin nhắn **mới nhất của mỗi cuộc trò chuyện luôn được giữ lại**, để danh sách chat không bị trống.

## 13. App Think Beta (app thật, thư mục `native/`)

Bản app viết lại bằng React Native (Expo), dùng chung máy chủ và tài khoản với bản web, cài song song với app bong bóng chat ở mục 7. Hướng dẫn đầy đủ: **[native/README.md](native/README.md)**. Tóm tắt:

1. Push code lên GitHub như thường lệ.
2. Repo → **Settings → Secrets and variables → Actions**, thêm secret `THINK_SIGNING_KEY` (mã mở khóa ký app, gửi riêng) và, để có thông báo đẩy, `GOOGLE_SERVICES_JSON` (file của Firebase cho app `com.nuwngc.think.beta`).
3. Tab **Actions → App Think (Android) → Run workflow**. Khoảng 20–30 phút sau, file `think-app.apk` có trong **Releases**.

Máy chủ tự hỗ trợ app này (đăng nhập bằng mã phiên, thông báo qua Firebase Cloud Messaging dùng chung khóa `FIREBASE_SERVICE_ACCOUNT`), không cần đổi cấu hình Render.

## 14. Cờ vua

Tab **Cờ vua** có trên bản web và App Think Beta (cùng dữ liệu, chơi chéo được: người dùng web đấu với người dùng app).

- **Thách đấu**: bấm **Thách đấu**, chọn người, thời gian mỗi bên (1+0, 2+1, 3+0, 3+2, 5+0, 5+3, 10+0, 15+10, 30+0 hoặc **không giới hạn**; "5+3" là 5 phút, đi xong mỗi nước cộng 3 giây), màu quân và có **tính điểm ELO** hay không. Trong khung chat riêng có nút quân mã để thách nhanh người đó. Người được thách nhận thông báo, bấm **Nhận** là vào ván ngay. Lời thách đấu tự hết hạn sau 15 phút.
- **Đồng hồ** chạy trên máy chủ nên không gian lận được, mạng chập chờn cũng không lệch. Ván có giờ: mỗi bên phải đi nước đầu trong 1 phút, không thì ván tự hủy (không ai mất điểm). Hết giờ là thua, trừ khi đối thủ không còn đủ quân để chiếu hết (hòa).
- **Luật đầy đủ**: nhập thành, bắt tốt qua đường, phong cấp (chọn quân), chiếu hết, hòa pat, không đủ quân, lặp lại 3 lần, luật 50 nước, mời hòa, đầu hàng, hủy ván khi chưa ai đi, đấu lại (đổi màu).
- **ELO**: ai cũng bắt đầu từ 1200. Chỉ ván **người với người** có bật "Tính điểm" mới cộng/trừ điểm (hệ số K = 40 trong 20 ván đầu, sau đó 20). Dấu **?** cạnh điểm là điểm tạm (dưới 10 ván). **Bảng xếp hạng** ở nút biểu đồ trên đầu tab.
- **Chơi với máy** (không tính điểm), máy chạy trên máy chủ:

  | Máy | Sức cờ ước lượng | Mã nguồn | Giấy phép |
  |---|---|---|---|
  | Gà Mờ, Tập Sự, Học Trò | ~500, ~800, ~1000 | [js-chess-engine](https://github.com/josefjadrny/js-chess-engine) | MIT |
  | GarboChess | ~1600 | [GarboChess-JS](https://github.com/glinscott/Garbochess-JS) (chép vào `src/engines/`) | BSD |
  | Stockfish · Dễ / Vừa / Khó / Mạnh nhất | ~1300 → ~3000 | [Stockfish 11](https://github.com/official-stockfish/Stockfish) (bản WebAssembly của [stockfish.js](https://github.com/nmrugg/stockfish.js)) | GPL-3.0 |

  Máy cờ chạy trong một luồng riêng, lần lượt từng ván, nên Render Free (0,1 CPU) vẫn chịu được; máy mạnh nhất nghĩ khoảng 1,5 giây mỗi nước.
- **Xem lại ván**: mọi ván đã xong nằm trong **Lịch sử** (nút ở mục "Ván gần đây"). Mở một ván để xem từng nước (nút ‹ ›, trên máy tính dùng phím ← → Home End) hoặc bấm **Xem lại từ đầu** để tự chạy mỗi giây một nước.
- **Phân tích ván** (ván đã xong): bấm **Phân tích bằng Stockfish**. Máy chủ chấm từng nước (khoảng 1 phút, xong có thông báo), rồi hiện:
  - **độ chính xác** của mỗi bên (cách tính giống lichess) và số nước **thiếu chính xác ?!**, **sai lầm ?**, **sai lầm nghiêm trọng ??**;
  - **biểu đồ** thế trận qua từng nước (bấm vào để nhảy tới nước đó), ký hiệu ?! ? ?? ngay trong danh sách nước đi;
  - nhận xét cho từng nước kèm **nước tốt nhất**, và **mũi tên xanh** chỉ nước máy gợi ý trên bàn cờ.

  Nước đã đi được chấm cùng thế cờ gốc với nước tốt nhất (lệnh `searchmoves` của Stockfish) nên không bị "báo sai" vì độ sâu tìm kiếm khác nhau. Mỗi ván chỉ phân tích một lần rồi lưu lại; máy chủ phân tích lần lượt từng ván, xen kẽ với lượt đi của máy cờ nên ván đang chơi không bị chậm. Ván đang chơi thì không phân tích được (tránh gian lận).
- **Tùy chọn bàn cờ** (nút ⚙ trên đầu tab Cờ vua và trong ván): bật/tắt **chỉ dẫn nước đi** (chấm ở ô đi được), **tô màu nước vừa đi**, **tọa độ bàn cờ**, **mũi tên gợi ý khi phân tích**, **âm thanh**. Lưu riêng trên từng máy.
- **Âm thanh**: tiếng quân cờ khi đi, ăn quân, nhập thành, chiếu tướng, bắt đầu và kết thúc ván. Các tiếng này tự tổng hợp bằng `scripts/chess-sounds.py` (không lấy của ai), dùng chung cho web (`public/chess/sounds/`) và app (`native/assets/sounds/`).
- Luật cờ dùng [chess.js](https://github.com/jhlywa/chess.js) (BSD-2-Clause) ở cả máy chủ, web và app. Hình quân cờ là bộ **cburnett** của Colin M.L. Burnett (GPLv2+, xem `public/chess/pieces/LICENSE.txt`).

## Cấu trúc thư mục

```
start.js             Điểm khởi động (npm start): tải dữ liệu từ Firebase nếu có, rồi chạy server
server.js            Máy chủ: API, realtime (Socket.IO), gửi thông báo
src/db.js            Database SQLite và bảng dữ liệu
src/cloud.js         Sao lưu database, ảnh, khóa thông báo lên Firebase Firestore
src/storage.js       Đo bộ nhớ máy chủ, tự dọn và dọn thủ công dữ liệu cũ
src/auth.js          Mã hóa mật khẩu (scrypt), phiên đăng nhập
src/push.js          Thông báo đẩy (Web Push / VAPID)
src/fcm.js           Thông báo đẩy cho App Think Beta (Firebase Cloud Messaging)
src/chess.js         Cờ vua: thách đấu, đồng hồ, ELO, bảng xếp hạng, API /api/chess
src/chess-engine.js  Hàng đợi gửi việc cho máy cờ; src/chess-worker.js chạy máy cờ trong luồng riêng
src/chess-analysis.js Phân tích ván đã xong bằng Stockfish (độ chính xác, xếp loại nước đi)
src/engines/         GarboChess-JS (giữ nguyên giấy phép BSD ở đầu file)
scripts/admin.js     Công cụ dòng lệnh cho chủ server
scripts/tunnel.js    Mở link HTTPS tạm thời (npm run share / npm run tunnel)
scripts/chess-sounds.py Tạo lại âm thanh cờ vua (cần Python + numpy)
public/              Giao diện: index.html, app.css, app.js, localdb.js (lưu trên máy), sw.js (service worker),
                     chess-ui.js (tab Cờ vua), chess/pieces/ (hình quân cờ), chess/sounds/ (âm thanh)
public/download/     File cài app Android (think.apk) và version.json
android/             Mã app Android: mở web bằng Chrome, bong bóng chat, trả lời trong thông báo (build.sh để build)
native/              App Think Beta (React Native / Expo), xem native/README.md
.github/workflows/   GitHub Actions: build và đăng file APK của App Think Beta
deploy/              Mẫu cấu hình Caddy và Nginx
```

Phông chữ Be Vietnam Pro dùng giấy phép SIL Open Font License (xem `public/fonts/OFL.txt`).
