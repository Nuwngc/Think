# Think — web chat riêng cho hội bạn

App chat chạy trên web, cài được lên điện thoại như app thật (PWA), có thông báo đẩy kể cả khi đã đóng app.

**Tính năng**

- Tài khoản do admin cấp, không ai tự đăng ký được. Lần đầu đăng nhập bắt buộc đổi mật khẩu tạm.
- Mỗi người tự đổi được: tên hiển thị, mật khẩu, ảnh đại diện.
- Phòng chung cho cả nhóm, nhắn riêng 1-1, và **nhóm chat riêng** tự tạo (đặt tên, thêm/xóa người, rời nhóm, có trưởng nhóm).
- Gửi ảnh (tự nén trên máy trước khi gửi), dán ảnh bằng Ctrl+V trên máy tính.
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
- Làm APK (mục 7): dùng link onrender.com, điền `ANDROID_PACKAGE` và `ANDROID_SHA256` trong Environment thay cho file assetlinks.json.
- Hạn mức Firestore miễn phí: 1 GiB dữ liệu, 50.000 lượt đọc, 20.000 lượt ghi mỗi ngày, dư sức cho một nhóm bạn.
- Log báo `Chưa tạo Firestore Database`: làm lại bước 1.2. Báo `Khóa Firebase không hợp lệ`: dán lại đúng nội dung file `.json`.

## 5. Lần đầu sử dụng

1. Đăng nhập bằng tài khoản admin in ra ở log, đặt mật khẩu mới.
2. Bấm biểu tượng cái khiên ở góc trên → **Tạo tài khoản mới** cho từng người.
   Để trống ô mật khẩu tạm thì app tự tạo. Bấm **Sao chép** hoặc **Chia sẻ** để gửi thông tin qua Zalo/Messenger.
3. Bạn bè đăng nhập bằng mật khẩu tạm, app bắt đặt mật khẩu riêng rồi mới vào chat.

Muốn đổi tên, ảnh đại diện, mật khẩu: bấm vào ảnh đại diện của mình ở góc trên bên trái.

## 6. Cài app và bật thông báo

| Thiết bị | Cách cài |
|---|---|
| Android (Chrome) | Mở link, bấm **Cài app** trên dải nhắc, hoặc menu ⋮ → **Cài đặt ứng dụng** |
| iPhone / iPad (iOS 16.4+) | Mở bằng **Safari** → nút Chia sẻ → **Thêm vào MH chính**, rồi mở app từ màn hình chính |
| Máy tính (Chrome/Edge) | Bấm biểu tượng cài đặt ở cuối thanh địa chỉ |

Sau khi cài, mở app → bấm **Bật thông báo** (dải nhắc ở đầu danh sách, hoặc trong Tài khoản → Thông báo). Bấm **Gửi thử** để kiểm tra.

Trên iPhone, thông báo **chỉ chạy trong app đã thêm vào màn hình chính**, không chạy trong tab Safari thường.

**Muốn file APK để cài như app thường?** Xem mục 7.

## 7. Tạo file APK cho Android

File APK là "vỏ" mở web Think toàn màn hình như app thường (công nghệ Trusted Web Activity chạy bằng Chrome), nên **thông báo đẩy vẫn hoạt động**. Sửa code web thì **không cần** làm lại APK, chỉ làm lại khi đổi tên miền, tên app hoặc icon.

**Điều kiện:** web phải chạy ở một địa chỉ HTTPS **cố định** (VPS + tên miền, xem mục 3). Link `trycloudflare.com` đổi mỗi lần chạy lại nên không làm APK được: link đổi là APK hỏng.

1. Mở **pwabuilder.com** (trên điện thoại hay máy tính đều được), dán địa chỉ web, vd `https://chat.tenmien.com`, bấm Start.
2. Chọn đóng gói cho **Android** rồi tạo gói (Generate Package).
3. Trong phần tùy chọn:
   - Package ID: đặt dạng `com.tenban.think` (chỉ chữ thường không dấu, số, dấu chấm).
   - **Signing key: chọn New.** Mặc định là None (APK chưa ký, không cài được). Điền tên và mật khẩu cho khóa.
4. Tải file zip về và giải nén. Bên trong có:
   - file `.apk` để cài lên điện thoại,
   - `assetlinks.json` để đưa lên server,
   - file khóa `.keystore` và thông tin khóa: **cất kỹ**, cần khi muốn làm bản APK mới mà không bắt mọi người gỡ app.
5. Đưa `assetlinks.json` lên server: chép vào thư mục `data/` của project, thành `data/assetlinks.json`. Không cần khởi động lại.
   Trên VPS cách nhanh nhất: mở file đó, sao chép toàn bộ nội dung, chạy `nano data/assetlinks.json`, dán vào rồi lưu.
   Kiểm tra: mở `https://chat.tenmien.com/.well-known/assetlinks.json` thấy nội dung là được.
6. Gửi file `.apk` cho bạn bè qua Zalo hoặc Google Drive. Khi cài, điện thoại hỏi quyền cài ứng dụng không rõ nguồn gốc thì cho phép; Play Protect cảnh báo thì chọn "Vẫn cài đặt".

Lần đầu mở app có thể hiện dòng nhỏ báo đang chạy bằng Chrome, đó là bình thường. Nếu app hiện **thanh địa chỉ** ở trên cùng nghĩa là `assetlinks.json` chưa đúng: kiểm tra lại bước 5.

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
| `RESET_ADMIN_PASSWORD` | Đặt lại mật khẩu admin khi khởi động (xóa đi sau khi dùng) | trống |
| `FIREBASE_PREFIX` | Tiền tố tên bảng trên Firestore, đổi nếu chạy nhiều app chung một project | `think` |

Màu sắc nằm ở đầu file `public/app.css` (biến `--jade`, `--turmeric`). Icon app nằm trong `public/icons/`.

## 11. Xử lý sự cố

- **Không nhận được thông báo**: app phải mở bằng `https://`. Kiểm tra đã cho phép thông báo chưa, bấm **Gửi thử**. Trên Android, tắt chế độ tối ưu pin cho Chrome. Trên iPhone, phải mở từ màn hình chính.
- **Cứ hiện "Mất kết nối"**: proxy chưa chuyển tiếp WebSocket. Với Nginx phải có 2 dòng `Upgrade` / `Connection` như trong `deploy/nginx.conf`.
- **Lỗi "Không tìm thấy SQLite"**: Node cũ hơn 22.13, cần cập nhật Node.
- **Lỗi database trên Termux**: chuyển project ra khỏi `/sdcard`, để trong thư mục home (`~`).
- **cloudflared báo `failed to dial to edge with quic` hoặc link chết**: dùng `npm run share` / `npm run tunnel` thay cho lệnh cloudflared tự gõ (mục 2). Muốn xem log đầy đủ: `TUNNEL_DEBUG=1 npm run tunnel`.
- **Cổng đã có người dùng (EADDRINUSE)**: đổi `PORT` trong `.env`.
- **App APK có thanh địa chỉ ở trên**: `assetlinks.json` thiếu hoặc sai (mục 7, bước 5). Sửa xong thì xóa dữ liệu Chrome của trang web đó trên điện thoại rồi mở lại app.

## Cấu trúc thư mục

```
start.js             Điểm khởi động (npm start): tải dữ liệu từ Firebase nếu có, rồi chạy server
server.js            Máy chủ: API, realtime (Socket.IO), gửi thông báo
src/db.js            Database SQLite và bảng dữ liệu
src/cloud.js         Sao lưu database, ảnh, khóa thông báo lên Firebase Firestore
src/auth.js          Mã hóa mật khẩu (scrypt), phiên đăng nhập
src/push.js          Thông báo đẩy (Web Push / VAPID)
scripts/admin.js     Công cụ dòng lệnh cho chủ server
scripts/tunnel.js    Mở link HTTPS tạm thời (npm run share / npm run tunnel)
public/              Giao diện: index.html, app.css, app.js, sw.js (service worker)
deploy/              Mẫu cấu hình Caddy và Nginx
```

Phông chữ Be Vietnam Pro dùng giấy phép SIL Open Font License (xem `public/fonts/OFL.txt`).
