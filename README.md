# Think — web chat riêng cho hội bạn

App chat chạy trên web, cài được lên điện thoại như app thật (PWA), có thông báo đẩy kể cả khi đã đóng app.

**Tính năng**

- Tài khoản do admin cấp, không ai tự đăng ký được. Lần đầu đăng nhập bắt buộc đổi mật khẩu tạm.
- Mỗi người tự đổi được: tên hiển thị, lời giới thiệu, ảnh đại diện, **ảnh bìa**, mật khẩu.
- **Trang cá nhân và bảng tin** (mục 15): đăng bài (chữ + ảnh), thả tim ❤️, bình luận, xem trang của từng người; **chia sẻ ván cờ** lên trang cá nhân hoặc gửi vào cuộc trò chuyện.
- Phòng chung cho cả nhóm, nhắn riêng 1-1, và **nhóm chat riêng** tự tạo (đặt tên, thêm/xóa người, rời nhóm, có trưởng nhóm).
- Gửi ảnh (tự nén trên máy trước khi gửi), dán ảnh bằng Ctrl+V trên máy tính.
- Thanh điều hướng dưới cùng: **Tin nhắn**, **Trò chơi** (Nông trại, Xếp Khối, Cờ vua, Cờ caro), **Cá nhân** (trang cá nhân + bảng tin; nút ⚙ **Cài đặt**: tên, giới thiệu, ảnh bìa, giao diện sáng/tối, thông báo, lưu trên máy, đổi mật khẩu) và **Quản trị** (chỉ admin thấy).
- **Lưu trên máy người dùng**: tin nhắn và ảnh được giữ lại trên điện thoại, mở app là xem được ngay kể cả khi mất mạng hay máy chủ đang thức dậy. Tải lịch sử chat thành file, tải ảnh về máy.
- **Bộ nhớ máy chủ**: thanh hiển thị dung lượng đã dùng, **tự dọn ảnh và tin nhắn cũ nhất khi sắp đầy**, dọn thủ công có xem trước.
- **App Android có bong bóng chat** (Android 8 trở lên): tin nhắn mới hiện thành bong bóng nổi như Messenger, chạm vào để trả lời ngay; thông báo có ảnh từng người gửi, ô **Trả lời** và nút **Đã đọc**. Tải app ngay trên web (Cá nhân → Cài app lên máy).
- **App Think Beta** (thư mục `native/`): app thật viết bằng React Native, không phải trang web trong khung. GitHub tự build file APK mỗi lần sửa code (mục 13).
- **Trò chơi** (mục 16): tab riêng chứa **Nông trại**, **Xếp Khối**, **Cờ vua**, **Cờ caro**, có bảng xếp hạng của cả nhóm.
- **Nông trại** (mục 20, mới ở 2.2.0): trồng 15 loại cây theo thời gian thật, nuôi gà bò, **tự nấu mì cay, pha trà sữa trân châu**, nướng pizza, làm kem xoài… rồi **bán ở chợ** (giá đổi mỗi ngày, có món hot) hoặc **giao đơn cho khách** lấy xu; lên cấp mở thêm cây, món, ô đất; **ghé vườn bạn bè** bắt sâu giúp hoặc **hái trộm**, nuôi chó giữ vườn; bảng xếp hạng cấp độ và xu tuần này. Có trên web và App Think Beta.
- **Tin nhắn thoại** (mục 23, mới ở 2.5.0): **giữ nút micro để nói, thả tay là gửi**, kéo ngón tay ra xa để hủy; chạm nhanh để ghi rảnh tay. Nghe có dạng sóng, tua, đổi tốc độ 1× / 1,5× / 2×, phát xong tự phát tin kế tiếp. Có trên web và App Think Beta.
- **Thành tựu** (mục 24, mới ở 2.5.0): huy hiệu **Đồng / Bạc / Vàng** trên trang cá nhân — chuỗi ngày chơi, thắng cờ vua / caro, ELO, Xếp Khối, câu đố, nông trại, bài đăng, tin nhắn.
- **Đóng băng chuỗi** ❄️ (mục 21, mới ở 2.5.0): mỗi tuần được 1 lượt (giữ tối đa 2), lỡ quên chơi một ngày thì tự dùng để chuỗi không bị đứt.
- **Quiz hằng ngày + Thử thách nhanh** (mục 22, mới ở 2.4.0): Cờ vua, Xếp Khối, Cờ caro mỗi game có **một câu đố mỗi ngày** cho cả nhóm cùng giải (xem ai giải nhanh nhất) và **200 màn thử thách** mở dần, mỗi màn 1–3 sao, bảng xếp hạng sao; thêm màn được bất cứ lúc nào. Chơi được khi mất mạng (Xếp Khối, cờ caro), có trên web và App Think Beta.
- **Chuỗi hằng ngày** (mục 21, mới ở 2.3.0): mỗi game (Nông trại, Xếp Khối, Cờ vua, Cờ caro) có **chuỗi ngày chơi liên tiếp** riêng 🔥 và một chuỗi chung; thẻ game hiện số ngày, có lịch 7 ngày, mốc 3 / 7 / 14 / 30… ngày được chúc mừng, buổi tối nhắc nếu chuỗi sắp đứt. Game nào thêm sau này cũng phải có chuỗi.
- **Cờ vua** (mục 14): thách đấu bạn bè, chọn thời gian (1+0 … 30+0 hoặc không giới hạn), đồng hồ do máy chủ giữ, **quân cờ trượt mượt và kéo thả bằng ngón tay như chess.com**, **điểm ELO và bảng xếp hạng**, chơi với 8 máy cờ mã nguồn mở (có Stockfish), **xem lại ván**, **đánh giá ván kiểu Game Review**: mỗi nước được xếp loại **Thiên tài !!, Tuyệt vời !, Tốt nhất, Rất tốt, Tốt, Theo sách, Thiếu chính xác ?!, Sai lầm ?, Bỏ lỡ, Sai lầm nghiêm trọng ??**, có thanh đánh giá, nhận xét từng nước, tên khai cuộc. Âm thanh quân gỗ giòn kiểu các trang cờ lớn. Có trên cả web lẫn App Think Beta.
- **Xếp Khối** (mục 16): game xếp khối 8×8 (kiểu Block Blast) có combo, hiệu ứng nổ, âm thanh, **chơi được khi mất mạng** (kể cả lúc máy chủ đang ngủ), điểm tự gửi lên **bảng xếp hạng** tuần này / mọi lúc khi có mạng.
- **Cờ caro** (mục 17, mới ở 2.1.0): bàn 15×15, luật tự do hoặc chặn hai đầu, **chơi với máy** 3 mức (chạy trên máy, không cần mạng), **thách đấu bạn bè** có giờ mỗi nước, **điểm ELO** và bảng xếp hạng. Có trên web và App Think Beta.
- **Chat 2.1.0** (mục 18): **chủ đề** cho từng cuộc trò chuyện, **biểu tượng gửi nhanh** (👍 kiểu Messenger), **sửa tin nhắn**, **ghim tin nhắn**, **tìm tin nhắn** không cần dấu, **chuyển tiếp**, **tắt thông báo** từng cuộc trò chuyện (1 giờ / 8 giờ / 24 giờ / đến khi bật lại), **ghim cuộc trò chuyện** lên đầu, **@nhắc tên** trong nhóm, **bình chọn**, xem **ảnh đã gửi**.
- **Bong bóng chat trong App Think Beta** (mục 18): ảnh người nhắn nổi trên màn hình, chạm để mở khung chat nhỏ trả lời ngay; app chạy nền nhận tin ngay cả trên máy **không có dịch vụ Google (Huawei)**.
- **Báo lỗi app tự động** (mục 19): app bị crash, màn hình lỗi… tự gửi về **Quản trị → Báo lỗi app** (tên máy, Android / HarmonyOS, bản app, chi tiết kỹ thuật). GitHub tự **chạy thử mỗi bản APK trên máy ảo Android 10 và 14** trước khi phát hành.
- **Trả lời tin nhắn** (chạm giữ → Trả lời, hoặc vuốt ngang tin nhắn) và **thả cảm xúc** ❤️ 😆 😮 😢 😡 👍, xem được ai đã thả.
- Realtime: đang nhập…, đang hoạt động / hoạt động X phút trước, "Đã xem" (nhóm hiện ảnh người đã xem), thu hồi tin nhắn.
- Thông báo đầy đủ:
  - Thông báo đẩy của hệ thống khi đóng app hoặc tắt màn hình (Android, iPhone iOS 16.4+, máy tính).
  - Gom tin theo cuộc trò chuyện: "Minh (3 tin nhắn)", bấm vào mở đúng cuộc trò chuyện.
  - Số tin chưa đọc trên biểu tượng app và trên tiêu đề tab.
  - Âm báo + thông báo nhỏ trong app khi đang mở.
- Admin: tạo tài khoản, đặt lại mật khẩu, khóa / mở khóa, cấp quyền admin. Khóa ai là người đó bị đăng xuất ngay.
- Màn đăng nhập nền đen chữ trắng; bên trong app **tự chọn nền sáng / tối** (Cài đặt → Giao diện: Theo máy, Nền sáng, Nền tối). Tìm kiếm không cần gõ dấu.

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

Muốn đổi tên, lời giới thiệu, ảnh đại diện, ảnh bìa, mật khẩu: bấm tab **Cá nhân** ở thanh dưới cùng rồi bấm nút ⚙ **Cài đặt** (đổi mật khẩu nằm trong mục **Bảo mật**).

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

Mục **Cờ vua** (trong tab Trò chơi) có trên bản web và App Think Beta (cùng dữ liệu, chơi chéo được: người dùng web đấu với người dùng app).

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
- **Đánh giá ván** (ván đã xong, kiểu "Game Review"): bấm **Đánh giá ván đấu**. Máy chủ cho Stockfish chấm từng thế cờ (khoảng 1 phút, xong có thông báo), rồi hiện:
  - **huy hiệu loại nước** ngay trên ô vừa đi tới và trong danh sách nước: **Thiên tài !!** (thí quân mà vẫn là nước tốt nhất), **Tuyệt vời !** (nước duy nhất giữ được thế cờ), **Tốt nhất ★**, **Rất tốt**, **Tốt**, **Theo sách** (nước khai cuộc có tên), **Thiếu chính xác ?!**, **Sai lầm ?**, **Bỏ lỡ ✕** (đối thủ vừa sai mà không tận dụng, hoặc bỏ lỡ chiếu hết), **Sai lầm nghiêm trọng ??**; nước chỉ có một cách đi là **Bắt buộc**;
  - **nhận xét như huấn luyện viên** cho từng nước ("Nxe5 là nước thiên tài! Thí Hậu rất đẹp…", "Nước tốt nhất là…", "Đối thủ có thể chiếu hết sau 2 nước"), nút **Xem nước tốt nhất** (hiện thế cờ trước nước đó với mũi tên xanh), nút Nước trước / Nước sau;
  - **thanh đánh giá** cạnh bàn cờ, **biểu đồ** thế trận có chấm màu ở các nước đáng chú ý (bấm để nhảy tới);
  - **bảng tổng kết**: độ chính xác mỗi bên (cách tính của lichess: trung bình có trọng số theo độ biến động + trung bình điều hòa), số nước từng loại của mỗi bên, **tên khai cuộc** (mã ECO), danh sách **khoảnh khắc đáng chú ý**.

  Cách xếp loại: so khả năng thắng (theo điểm Stockfish) trước và sau nước đi, ngưỡng tụt 2 / 5 / 10 / 20 điểm phần trăm cho Rất tốt / Tốt / Thiếu chính xác / Sai lầm / Sai lầm nghiêm trọng. Máy chấm hai nước tốt nhất mỗi thế cờ (MultiPV 2) để biết nước nào là "nước duy nhất". Nước đã đi được chấm cùng thế cờ gốc với nước tốt nhất (lệnh `searchmoves`) nên không bị báo sai vì độ sâu tìm kiếm. Sách khai cuộc lấy từ [lichess-org/chess-openings](https://github.com/lichess-org/chess-openings) (CC0), gọn trong `src/chess-openings.tsv` (tạo lại bằng `scripts/build-openings.js`). Ván đã phân tích từ bản cũ tự được xếp loại lại khi mở. Mỗi ván chỉ phân tích một lần; ván đang chơi không phân tích được (tránh gian lận).
- **Tùy chọn bàn cờ** (nút ⚙ trên đầu mục Cờ vua và trong ván): bật/tắt **chỉ dẫn nước đi** (chấm ở ô đi được), **tô màu nước vừa đi**, **tọa độ bàn cờ**, **mũi tên gợi ý khi phân tích**, **quân trượt khi đi**, **âm thanh**. Lưu riêng trên từng máy.
- **Đi quân kiểu chess.com**: chạm quân rồi chạm ô đích, hoặc **kéo quân bằng ngón tay** (quân nhấc lên to hơn, ô dưới ngón tay có viền sáng; thả ra ngoài hay vào ô không đi được thì quân trượt về chỗ cũ). Mọi nước đi — của mình, của đối thủ, của máy, khi xem lại ván hay nhảy về đầu ván — đều **trượt mượt** từ ô đi tới ô đến (nhập thành: vua và xe cùng trượt), quân bị ăn mờ dần. Tắt được ở **Quân trượt khi đi**; máy bật "giảm chuyển động" thì tự tắt. Cách tính quân nào trượt đi đâu nằm ở `public/chess-anim.js` (web) và `native/src/chess/anim.ts` (app), có kiểm thử so khớp hai bản.
- **Âm thanh** (phong cách các trang cờ lớn): tiếng quân gỗ giòn khi đi — **nước của mình và của đối thủ nghe khác nhau** —, ăn quân ("cạch"), nhập thành (hai tiếng), chiếu tướng, phong cấp, **còn 10 giây** (tích tắc), đi sai (kéo quân vào ô không đi được), bắt đầu và kết thúc ván. Các tiếng này tự tổng hợp bằng `scripts/chess-sounds.py` (mô phỏng quân gỗ va bàn gỗ, không lấy file của trang nào), dùng chung cho web (`public/chess/sounds/`) và app (`native/assets/sounds/`).
- Luật cờ dùng [chess.js](https://github.com/jhlywa/chess.js) (BSD-2-Clause) ở cả máy chủ, web và app. Hình quân cờ là bộ **cburnett** của Colin M.L. Burnett (GPLv2+, xem `public/chess/pieces/LICENSE.txt`).

## 15. Trang cá nhân và bảng tin

Có trên bản web và App Think Beta (cùng dữ liệu).

- **Trang cá nhân**: ảnh bìa, ảnh đại diện, tên, lời giới thiệu (tối đa 160 ký tự), ngày tham gia, số bài viết, số lượt thích nhận được và điểm ELO cờ vua. Bấm tên / ảnh của ai (trong bài đăng, bình luận) để xem trang của người đó, có nút **Nhắn tin** và **Thách cờ**.
- **Đăng bài**: ô "Bạn đang nghĩ gì?" ở tab Cá nhân. Mỗi bài có chữ (tối đa 2000 ký tự) và/hoặc một ảnh (tự thu nhỏ trên máy trước khi gửi). Người đăng và admin xóa được bài.
- **Bảng tin**: tab Cá nhân có hai mục **Bảng tin** (bài mới của cả nhóm) và **Bài của tôi**. Bài mới, lượt thích, bình luận hiện ngay không cần tải lại.
- **Thả tim, bình luận**: bấm ❤️ để thích (bấm lại để bỏ), "Ai đã thích?" để xem ai thích. Bình luận xóa được bởi người viết, chủ bài hoặc admin. Có người thích / bình luận bài của bạn thì bạn nhận thông báo (khi không mở app).
- **Chia sẻ ván cờ**: trong một ván cờ bấm nút chia sẻ ⇪ rồi chọn **Đăng lên trang cá nhân** (bài có bàn cờ nhỏ, bấm để xem lại ván) hoặc **Gửi vào cuộc trò chuyện** (hiện thành thẻ ván cờ trong chat, bấm để mở). Người không chơi ván đó vẫn xem lại được từng nước và kết quả phân tích (nếu người chơi đã phân tích), nhưng không yêu cầu phân tích hay đăng lại được.
- **Ảnh bìa**: Cài đặt → Ảnh bìa (hoặc nút "Ảnh bìa" trên trang cá nhân), tối đa 4 MB, khung 16:6. Gỡ ảnh bìa thì dùng nền màu mặc định.
- **Giao diện sáng / tối**: Cài đặt → Giao diện. Lưu riêng trên từng máy.

## 16. Trò chơi và Xếp Khối

Tab **Trò chơi** (thay cho tab Cờ vua cũ) có trên bản web và App Think Beta: thẻ **Nông trại** (mục 20), **Xếp Khối**, **Cờ vua** (điểm ELO, việc cần làm), **Cờ caro** (mục 17), cùng **bảng xếp hạng** của cả nhóm. Đường dẫn trên web: `#/games`, `#/chess`, `#/blocks`. Nhấn giữ biểu tượng app Think (bản cài từ web) có lối tắt **Xếp Khối** và **Cờ vua**.

**Xếp Khối** (kiểu Block Blast):

- Bàn 8×8, mỗi lượt có 3 khối (đủ hình: 1 ô, thanh 2–5 ô, vuông 2×2 và 3×3, chữ nhật, góc, chữ L/J/T/S/Z, góc lớn). **Kéo khối vào bàn** (trên điện thoại khối nổi lên trên ngón tay để không bị che); hàng / cột sắp đầy **sáng lên cùng màu khối** trước khi thả. Thả sai chỗ thì khối bay về khay. Cũng có thể **chạm chọn khối rồi chạm ô** để đặt; trên máy tính dùng phím 1–3, mũi tên, Enter; trình đọc màn hình có con trỏ riêng.
- **Điểm**: mỗi ô đặt được 1 điểm; ăn 1 / 2 / 3 / 4 / 5 / 6 hàng cùng lúc được 10 / 25 / 45 / 70 / 100 / 135 điểm, nhân với **combo** (ăn hàng liên tiếp, tối đa ×10; đặt 3 khối liền không ăn hàng nào thì mất combo); **dọn sạch bàn** +300. Hết chỗ đặt cả 3 khối là hết ván. Khối mới luôn được chọn sao cho đặt được ít nhất một khối.
- Hiệu ứng: ô nổ tung lan dần từ chỗ vừa đặt, điểm bay lên, lời khen **Tốt lắm! / Tuyệt vời! / Xuất sắc! / Không thể tin nổi! / Sạch bàn!**, huy hiệu **Combo ×N**, bảng **Kỷ lục mới!**.
- **Âm thanh** như game gốc: cầm khối, đặt khối "cộp", ăn hàng lấp lánh (càng nhiều hàng càng dày), combo nốt cao dần, dọn sạch bàn, kỷ lục, hết ván, thả sai. Tự tổng hợp bằng `scripts/blocks-sounds.py`. Bật/tắt bằng nút loa trong game.
- **Chơi khi mất mạng**: ván đang chơi, kỷ lục và các ván chưa gửi đều lưu trên máy. Bản web có trang riêng **`/blocks.html`** được lưu sẵn (service worker), mở tức thì kể cả khi máy chủ đang ngủ hay mất mạng — màn chờ máy chủ và màn đăng nhập đều có nút **Chơi Xếp Khối**. App Think Beta cũng có nút này ở màn đăng nhập / màn chờ.
- **Bảng xếp hạng** (nút biểu đồ trong game): **Tuần này** (từ 0 giờ thứ Hai, giờ Việt Nam) và **Mọi lúc**, kèm kỷ lục, hạng, số ván của bạn. Điểm các ván chơi lúc mất mạng tự gửi lên khi có mạng (mỗi ván có mã riêng nên gửi lại không bị tính trùng; ván cũ hơn 30 ngày không nhận). Ai vừa **vượt lên số 1** thì cả nhóm thấy thông báo nhỏ. Kỷ lục Xếp Khối hiện trên trang cá nhân.
- Máy chủ chỉ giữ điểm (bảng `game_scores`, `game_bests` trong `src/games.js`), kiểm tra điểm hợp lệ (mỗi nước tối đa 1.700 điểm), giới hạn 30 lần gửi / 10 phút mỗi người. Luật game giống hệt nhau ở web (`public/blocks-core.js`) và app (`native/src/blocks/engine.ts`) — có kiểm thử so khớp.

## 17. Cờ caro

Thẻ **Cờ caro** trong tab Trò chơi (web: `#/caro`), có trên bản web và App Think Beta, chơi chéo được.

- **Luật**: bàn 15×15, ai có **5 quân liền** (ngang, dọc, chéo) trước là thắng. Luật **Tự do** (5 quân trở lên là thắng) hoặc **Chặn hai đầu** (5 quân mà bị đối thủ chặn cả hai đầu thì không tính). X luôn đi trước. Kín bàn mà không ai thắng là hòa.
- **Chơi với máy** (không cần mạng, ván dở tự lưu trên máy): **Dễ**, **Vừa**, **Khó** (máy tính trước nhiều nước). Chọn đi trước / đi sau, luật; có **Đi lại** và **Đổi bên**. Thành tích thắng / thua theo từng mức.
- **Thách đấu bạn bè**: chọn người, thời gian **mỗi nước** (15 / 30 / 60 / 120 giây hoặc không giới hạn), bên (X / O / ngẫu nhiên), luật, có **tính điểm ELO** hay không. Đồng hồ do máy chủ giữ; hết giờ một nước là thua. Có **đầu hàng**, **đấu lại**, thông báo khi có người thách hoặc tới lượt. **Bảng xếp hạng** ELO riêng của cờ caro (bắt đầu 1200).
- Chạm một ô để xem trước quân mờ, chạm lần nữa để đánh (tránh bấm nhầm trên điện thoại). Âm thanh (tắt được, tạo bằng `scripts/caro-sounds.py`) và pháo giấy khi thắng.
- Luật và máy giống hệt nhau ở máy chủ (`src/caro.js`), web (`public/caro-core.js`) và app (`native/src/caro/engine.ts`), có kiểm thử so khớp.

## 18. Chat 2.1.0 và bong bóng chat

Có trên bản web và App Think Beta (cùng dữ liệu):

- **Tùy chỉnh đoạn chat** (nút ⓘ trên đầu khung chat): **12 chủ đề màu** (màu bong bóng tin của mình, mọi người trong cuộc trò chuyện đều thấy), **biểu tượng gửi nhanh** (ô nhập trống thì nút gửi thành biểu tượng này, bấm là gửi), tắt thông báo, ghim, tin đã ghim, **ảnh đã gửi**.
- **Sửa tin nhắn** của mình (chạm giữ → Sửa; tin hiện "Đã chỉnh sửa"), **ghim tin nhắn** (thanh ghim trên đầu khung chat, chạm để nhảy tới tin đó), **tìm tin nhắn** trong cuộc trò chuyện (không cần dấu), **chuyển tiếp** tin sang một hoặc nhiều cuộc trò chuyện.
- **Tắt thông báo** từng cuộc trò chuyện (1 giờ, 8 giờ, 24 giờ, đến khi bật lại) — vẫn báo khi có người **@nhắc tên** bạn; **ghim cuộc trò chuyện** lên đầu danh sách. Trong app: chạm giữ một cuộc trò chuyện ở danh sách.
- **@nhắc tên** trong nhóm (gõ @ để chọn người), người được nhắc thấy tin được tô vàng và vẫn nhận thông báo kể cả khi đã tắt.
- **Bình chọn**: nút ＋ → Tạo bình chọn (2–10 lựa chọn, chọn một hoặc nhiều), kết quả cập nhật ngay, người tạo kết thúc được.

**Bong bóng chat** (App Think Beta, Android 8 trở lên): **Cá nhân → ⚙ Cài đặt → Bong bóng chat**, lần đầu máy hỏi quyền **"Hiển thị trên ứng dụng khác"** — bật cho Think Beta rồi quay lại app. Khi có tin mới mà không mở app, ảnh người nhắn hiện nổi ở cạnh màn hình (số tin chưa đọc, xem trước nội dung); **chạm** để mở khung chat nhỏ ngay trên app đang dùng, trả lời xong bấm Quay lại để thu nhỏ; **kéo xuống dấu ✕** để ẩn. Khi bật, app chạy nền để nhận tin ngay (có thông báo "Bong bóng chat đang bật", có nút tắt), nên **máy Huawei / máy không có dịch vụ Google vẫn có thông báo tin mới**. Cuộc trò chuyện đã tắt thông báo thì không hiện bong bóng. Máy Huawei / Xiaomi / Oppo: vào Cài đặt → Pin → cho Think Beta chạy nền để bong bóng không bị máy tắt.

## 19. Báo lỗi app và Kiểm tra APK

- **Báo lỗi tự động**: App Think Beta tự gửi về máy chủ khi bị tắt đột ngột (crash Java / Kotlin, lỗi JavaScript làm tắt app — ghi lại ngay, lần mở sau gửi), khi một màn hình bị lỗi (hiện "Có lỗi xảy ra" với nút Thử lại thay vì tắt app) và lỗi chạy ngầm. Bản web cũng gửi lỗi trang. Admin xem ở **Quản trị → Báo lỗi app**: loại lỗi, số lần, tên máy, Android / **HarmonyOS**, bản app, ai gặp, ở màn hình nào, chi tiết kỹ thuật; lỗi giống nhau được gộp. Có lỗi làm tắt app mới thì admin đang mở trang này thấy ngay.
- **Kiểm tra APK** (`.github/workflows/apk-check.yml`): mỗi lần sửa `native/`, GitHub build một bản thử rồi **chạy trên máy ảo Android 10 và Android 14**, bấm qua các màn hình như người dùng thật (đăng nhập, nhắn tin, nông trại, cờ vua, Xếp Khối, trang cá nhân, chạy nền, tắt màn hình, **bong bóng chat**, báo lỗi), chụp màn hình và đọc logcat để bắt crash **trước khi phát hành**. Kết quả: trang của lần chạy (Summary) và nhánh `apk-check-results`. Chạy tay: tab Actions → **Kiểm tra APK** → Run workflow. Bước "Kiểm tra code" còn so phiên bản các thư viện native với bản Expo (`npm run check:native`) — lỗi crash ở bản 0.1.4 / 0.1.5 là do một thư viện bị cài lệch phiên bản.

## 20. Nông trại

Thẻ **Nông trại** đứng đầu tab Trò chơi (web: `#/farm`, ghé vườn một người: `#/farm/u/<mã người>`), có trên bản web và App Think Beta, dùng chung một nông trại.

- **Ruộng**: bấm ô trống để gieo hạt (hạt lúa mì miễn phí), 15 loại cây mở dần theo cấp: lúa mì, rau cải, bắp, mía, ớt, cà rốt, lá chè, khoai mì, cà chua, dâu tây, khoai tây, dưa hấu, bơ, cà phê, xoài. Cây lớn theo **thời gian thật**, kể cả khi tắt máy (3 phút tới 6 giờ); chín thì bấm để thu hoạch, hoặc **thu hoạch / gieo cả ruộng** một lần. Thỉnh thoảng **được mùa** thêm 1 sản phẩm; cây lâu ngày có thể bị **sâu** (bấm để bắt, không thì mất 1 sản phẩm). Mua thêm ô đất (6 → 24 ô).
- **Chế biến**: máy xay thức ăn, chuồng gà, bếp nấu, xưởng chế biến, quầy nước, lò nướng, chuồng bò, máy làm kem. Gà ăn cám đẻ trứng, bò ăn cỏ khô cho sữa; xưởng làm đường, mì sợi, trà khô, trân châu; bếp nấu **mì cay, mì cay cấp 7, bánh bao, lẩu thái, gỏi rau, khoai tây chiên**; lò nướng **bánh mì, pizza, bánh kem dâu**; quầy nước pha **nước mía, trà sữa trân châu, nước ép dưa hấu, sinh tố bơ, cà phê sữa đá**; máy làm **kem xoài**. Mỗi nơi làm lần lượt theo hàng chờ (2 chỗ, nâng tối đa 6), món xong bấm để lấy về kho.
- **Đơn hàng**: khách (Bà Tư, Ông Sáu, Bé Na, Chú Bảy… và Mèo Mun chỉ mua sữa với trứng) đặt mua; giao đủ hàng được nhiều xu hơn bán ở chợ, kèm kinh nghiệm. Đơn khó thì đổi, khách mới tới sau 3 phút.
- **Kho và chợ**: giá mỗi món đổi theo ngày (có mũi tên tăng / giảm), mỗi ngày một **món hot** bán được giá gấp rưỡi; bán 1 hoặc bán hết (nhắc nếu đơn hàng đang cần món đó). Nâng kho (100 → 600 chỗ). **Cửa hàng**: chó giữ vườn và 9 món trang trí sân vườn (hướng dương … lâu đài), cộng điểm vườn đẹp.
- **Lên cấp** (tối đa cấp 50): thu hoạch, làm món, giao đơn đều có kinh nghiệm; mỗi lần lên cấp được thưởng xu và mở thêm cây, món, công trình, ô đất. **Quà mỗi ngày** tăng dần khi ghé liên tục (15 → 80 xu).
- **Bạn bè**: bảng xếp hạng theo **cấp** và theo **xu kiếm được tuần này**; ghé vườn nhau để **bắt sâu giúp** (+3 xu, 15 lần mỗi ngày) hoặc **hái trộm** 1 sản phẩm ở ô đã chín (6 lần mỗi ngày, 3 lần mỗi vườn, ô phải còn ít nhất 2 sản phẩm). Vườn có **chó giữ vườn** thì kẻ trộm có 35% bị đuổi và phải đền 15 xu cho chủ vườn. Chủ vườn nhận thông báo (tối đa 1 lần / 10 phút) và xem được **nhật ký vườn**; App Think Beta có khung **"Khi bạn vắng nhà"** kể lại ai đã ghé.
- App Think Beta **báo khi cả ruộng đã chín** (thông báo hẹn giờ ngay trên máy, tắt được trong nút ⓘ Cách chơi); có âm thanh, chữ bay lên, sản phẩm bay về Kho.
- Máy chủ giữ hết luật (`src/farm-logic.js`), web và app chỉ hiển thị, nên không ai gian xu được. Muốn thêm cây, món mới chỉ cần sửa `src/farm-data.js` (thêm hình bằng `scripts/farm-icons.py`). Hình biểu tượng dùng **Twemoji** (CC-BY 4.0) để máy nào cũng hiện giống nhau, kể cả Android cũ; âm thanh tự tổng hợp (`scripts/farm-sounds.py`).

## 21. Chuỗi hằng ngày

Mỗi game có **chuỗi riêng**: ngày nào có chơi (đi một nước cờ, đặt một khối, làm một việc ở nông trại, ghé vườn bạn…) thì chuỗi tăng 1, bỏ một ngày là chuỗi về 0. Ngày tính theo **giờ Việt Nam**. Ngoài ra có **chuỗi chơi game** chung: ngày nào chơi game bất kỳ cũng tính.

- **Trang Trò chơi**: khung 🔥 chuỗi chung ở đầu trang (lịch 7 ngày, kỷ lục), mỗi thẻ game có nhãn "🔥 5 ngày"; hôm nay chưa chơi mà chuỗi còn thì nhãn vàng **"sắp đứt"**. Trong từng game cũng có huy hiệu chuỗi (đầu trang Nông trại, Xếp Khối, thẻ ELO của Cờ vua và Cờ caro). Bấm vào để xem **bảng chuỗi**: từng game, lịch 7 ngày, kỷ lục, các mốc.
- Chơi lần đầu trong ngày có thông báo nhỏ ("🔥 Chuỗi Cờ vua: 5 ngày liên tiếp!"); đạt **mốc** 3, 7, 14, 30, 50, 100, 150, 200, 365, 500, 1000 ngày thì có bảng chúc mừng.
- **Nhắc giữ chuỗi**: khoảng 20–23 giờ, ai có chuỗi từ 2 ngày mà hôm nay chưa chơi thì nhận một thông báo (mỗi ngày tối đa một lần). Tắt trong bảng chuỗi.
- Xếp Khối và cờ caro với máy chơi được khi mất mạng: ngày chơi lưu trên máy, có mạng thì gửi lên (nhận ngày chơi trễ tới 7 ngày), nên chuỗi không bị mất oan.
- **Đóng băng chuỗi** ❄️: mỗi thứ Hai được thêm 1 lượt (giữ tối đa 2; lần đầu được tặng 1 lượt). Ngày nào lỡ quên **không chơi game nào** mà hôm trước vẫn còn chuỗi, máy chủ tự dùng 1 lượt cho ngày đó: mọi chuỗi được nối qua ngày đó nhưng không cộng thêm. Lịch 7 ngày hiện bông tuyết ở ngày được đóng băng, mở app có thông báo nhỏ. Ngày đó sau này mới gửi lên (chơi lúc mất mạng) thì lượt được trả lại. Số lượt còn hiện ở khung chuỗi (trang Trò chơi) và trong bảng chuỗi.
- Ngày chơi tính theo **đồng hồ máy chủ**, không theo đồng hồ điện thoại: điện thoại để sai giờ hay sai ngày vẫn tích chuỗi đúng ngày (máy gửi kèm giờ của nó, máy chủ tự trừ độ lệch). Vì vậy chỉnh ngày trên điện thoại sang hôm sau không làm chuỗi tăng — phải chờ qua 0 giờ (giờ Việt Nam) thật.
- Máy chủ giữ chuỗi (`src/streaks.js`, bảng `streak_days`; API `GET /api/streaks`, `POST /api/streaks/played`, `POST /api/streaks/prefs`; realtime `streak:update`). Web: `public/streaks.js` + `streaks.css`; app: `native/src/streaks/`.

**Quy tắc cho game mới** (bắt buộc — `npm test` sẽ báo lỗi nếu thiếu):

1. Thêm game vào `GAMES` trong `src/streaks.js`, cùng mã với `GAME_IDS` trong `public/games-ui.js` và `native/src/games/registry.ts`.
2. Game chạy trên máy chủ: gọi `streaks.record(userId, '<mã game>')` mỗi khi người chơi thật sự chơi. Game chạy trên máy (chơi được khi mất mạng): đặt `client: true`, web gọi `ThinkStreaks.mark('<mã>', uid)`, app gọi `markPlayed("<mã>")`.
3. Thẻ game ở trang Trò chơi tự có nhãn chuỗi; thêm `ST.badge('<mã>')` (web) / `<StreakBadge game="<mã>" />` (app) vào đầu màn hình game.

## 22. Quiz hằng ngày và Thử thách nhanh

Cờ vua, Xếp Khối và Cờ caro có thêm hai chế độ câu đố (web và App Think Beta, dùng chung tiến độ):

- **Quiz hôm nay**: mỗi game một câu mỗi ngày (đổi lúc 0 giờ, giờ Việt Nam), cả nhóm cùng một câu. Khung "Quiz hôm nay" ở trang Trò chơi cho biết đã giải chưa và bao nhiêu người đã giải; giải xong thấy bảng **ai đã giải hôm nay** (nhiều sao hơn xếp trên, rồi ai nhanh hơn), cập nhật ngay khi có người vừa giải. Mỗi người chỉ tính lần giải đầu tiên.
- **Thử thách nhanh**: 200 màn mỗi game, chia chương 20 màn, dễ tới khó; giải xong màn trước mới mở màn sau. Mỗi màn 1–3 sao: không sai, không gợi ý = 3 sao; sai / gợi ý tổng cộng tối đa 2 lần = 2 sao; còn lại 1 sao. Bảng xếp hạng theo tổng số sao.
- **Cờ vua**: chiếu hết sau 1, 2, 3 nước và "thắng quân" (bắt đôi, ghim, ăn quân bị bỏ ngỏ). Đi sai thì quân trượt về, đi đúng thì máy đáp; nước chiếu hết cuối cùng đi kiểu nào cũng được. Các thế cờ lấy từ ván máy tự đánh, Stockfish tìm chỗ có đúng một nước hay nhất, chiếu hết 1–2 nước được thử hết mọi nước để chắc chắn.
- **Xếp Khối**: "đặt hết các khối để dọn sạch bàn" — khối ra 3 cái một lượt như game thật. Câu đố dựng ngược từ lời giải nên chắc chắn giải được; cách giải khác cũng được tính.
- **Cờ caro**: "thắng trong N nước" (bạn cầm X, luật tự do): mỗi nước phải tạo tứ để đối thủ buộc phải chặn, tới khi có 5 quân. Cách thắng khác lời giải vẫn được tính.
- Nút **Gợi ý** (tính như một lần sai khi chấm sao), **Làm lại**, **Xem lời giải** (máy tự đi; lần đó không được tính, quiz hôm nay thì không giải lại được nữa). Không có đồng hồ chạy trên màn hình; thời gian chỉ hiện lúc giải xong.
- Giải câu đố cũng tính là có chơi game đó trong ngày (chuỗi hằng ngày). Giải lúc mất mạng thì kết quả lưu trên máy, có mạng tự gửi.
- Máy chủ đi lại lời giải để kiểm tra trước khi ghi (`src/puzzles.js`; API `GET /api/puzzles`, `POST /api/puzzles/<game>/level`, `POST /api/puzzles/<game>/daily`; realtime `puzzle:daily`). Luật câu đố: `public/puzzles-core.js` (app: `native/src/puzzles/core.ts`, có kiểm thử so khớp). Dữ liệu: `public/puzzles/<game>.json` và bản giống hệt trong `native/src/puzzles/data/`.

**Thêm màn** (người chơi không bị đổi các màn đã có; app tự tải màn mới từ máy chủ, không cần cài bản mới):

```bash
node scripts/puzzles/blocks.js --add 50     # vài giây
node scripts/puzzles/caro.js --add 50 --minutes 20
node scripts/puzzles/chess.js --add 50 --minutes 40   # cần Stockfish (có sẵn trong node_modules)
npm test                                   # kiểm tra mọi câu đố vẫn giải được
```

## 23. Tin nhắn thoại

Có trên bản web và App Think Beta (nghe chéo được: ghi trên web, nghe trên app và ngược lại).

- **Ghi**: giữ nút **micro** (cạnh nút ảnh) để nói, **thả tay là gửi**; đang giữ mà **kéo ngón tay ra xa nút** thì thanh ghi âm chuyển đỏ "Thả tay để hủy". **Chạm nhanh** nút micro thì ghi rảnh tay: bấm **Gửi** hoặc **🗑 Hủy** trên thanh ghi âm. Tối đa **2 phút** (tới 2 phút tự gửi); ngắn hơn 0,7 giây coi như bấm nhầm. Đang trả lời tin nào thì tin thoại gắn vào tin đó.
- **Nghe**: nút phát / tạm dừng, **dạng sóng** chạy theo tiến độ (chạm vào sóng để tua), nút **1× / 1,5× / 2×** (nhớ cho lần sau), mỗi lúc chỉ phát một tin, phát xong tự phát tin thoại kế tiếp của người khác.
- Lần đầu ghi, máy hỏi quyền **micro** (web: trình duyệt hỏi; app: Android hỏi). Lỡ chặn thì vào cài đặt trình duyệt / Cài đặt → Ứng dụng → Think Beta → Quyền → Micrô để bật lại. Khung chat nổi (bong bóng chat) chỉ nghe, không ghi âm.
- Tin thoại **chuyển tiếp** và **thu hồi** được như tin thường; không sửa được. Danh sách chat và thông báo hiện "🎤 Tin nhắn thoại (0:12)".
- Máy chủ: `POST /api/upload/audio` nhận file (WEBM / OGG từ trình duyệt, M4A từ app; nhận dạng theo nội dung file, tối đa 6 MB), lưu ở `uploads/audio/` (cần đăng nhập mới nghe được, có tua) và sao lưu Firebase như ảnh. File tin thoại tính vào **bộ nhớ máy chủ** và được **dọn cùng ảnh** khi dọn / tự dọn (tin vẫn còn, hiện "Tin nhắn thoại đã được dọn khỏi máy chủ"). Dạng sóng và cách tính chung: `public/voice-core.js` (app: `native/src/voice/core.ts`, có kiểm thử so khớp).

## 24. Thành tựu

Trang cá nhân (web và App Think Beta) có mục **Thành tựu**: 12 huy hiệu, mỗi huy hiệu 3 bậc **Đồng / Bạc / Vàng**. Chạm một huy hiệu để xem cách đạt và còn thiếu bao nhiêu; huy hiệu chưa đạt có thanh tiến độ.

| Huy hiệu | Đồng / Bạc / Vàng |
|---|---|
| 🔥 Lửa bền bỉ — chơi game nhiều ngày liên tiếp (kỷ lục chuỗi chung) | 3 / 7 / 30 ngày |
| 🏆 Kỳ thủ — thắng ván cờ vua (cả với máy) | 1 / 10 / 50 ván |
| 👑 Cao thủ cờ vua — điểm ELO cao nhất | 1300 / 1500 / 1800 |
| 🎯 Vua caro — thắng cờ caro với bạn bè | 1 / 10 / 50 ván |
| 🎮 Thợ xếp khối — kỷ lục một ván Xếp Khối | 1.000 / 5.000 / 20.000 điểm |
| ⭐ Nhà giải đố — sao Thử thách nhanh | 30 / 150 / 450 sao |
| 📅 Quiz mỗi ngày — số quiz hằng ngày đã giải | 1 / 10 / 50 |
| 🌾 Nhà nông — cấp nông trại | 5 / 15 / 30 |
| ✍️ Người kể chuyện — bài đăng | 1 / 10 / 50 |
| ❤️ Được yêu mến — lượt thích nhận được (không tính tự thích) | 10 / 50 / 200 |
| 💬 Tám chuyện — tin nhắn đã gửi | 100 / 1.000 / 10.000 |
| 🎤 Giọng nói quen thuộc — tin nhắn thoại đã gửi | 1 / 20 / 100 |

Máy chủ tự tính từ dữ liệu có sẵn mỗi lần mở trang cá nhân (`src/achievements.js`, trả về trong `GET /api/users/<mã>/profile`), nên thành tích cũ cũng được tính. Vừa đạt bậc mới thì lần mở trang cá nhân kế tiếp có thông báo nhỏ "🏆 Thành tựu mới" và nhãn **Mới** (chỉ chủ trang thấy). Thêm huy hiệu: thêm một dòng vào `DEFS` và cách tính trong `valuesOf`.

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
src/chess-analysis.js Đánh giá ván đã xong bằng Stockfish (xếp loại thiên tài … sai lầm nghiêm trọng, độ chính xác)
src/chess-openings.js Sách khai cuộc (dữ liệu src/chess-openings.tsv, lichess-org/chess-openings, CC0)
src/games.js         Trò chơi trên máy (Xếp Khối): điểm, bảng xếp hạng tuần / mọi lúc (API /api/games)
src/social.js        Trang cá nhân và bảng tin: bài đăng, thả tim, bình luận (API /api/posts)
src/caro.js          Cờ caro: thách đấu, giờ mỗi nước, ELO, bảng xếp hạng (API /api/caro)
src/farm.js          Nông trại: lưu nông trại, ghé vườn bạn bè, bảng xếp hạng (API /api/farm)
src/farm-logic.js    Luật Nông trại (gieo, thu hoạch, chế biến, đơn hàng, chợ, hái trộm…); src/farm-data.js: cây, món, công trình
src/streaks.js       Chuỗi hằng ngày của mọi game (API /api/streaks, nhắc giữ chuỗi buổi tối)
src/puzzles.js       Quiz hằng ngày + Thử thách nhanh: tiến độ, kết quả, bảng xếp hạng (API /api/puzzles)
src/achievements.js  Thành tựu trên trang cá nhân (Đồng / Bạc / Vàng)
src/chat-plus.js     Chat 2.1.0: sửa tin, ghim, tìm, chuyển tiếp, tắt thông báo, chủ đề, bình chọn, ảnh đã gửi
src/reports.js       Báo lỗi app (API /api/app/errors, Quản trị → Báo lỗi app)
src/engines/         GarboChess-JS (giữ nguyên giấy phép BSD ở đầu file)
scripts/admin.js     Công cụ dòng lệnh cho chủ server
scripts/tunnel.js    Mở link HTTPS tạm thời (npm run share / npm run tunnel)
scripts/chess-sounds.py Tạo lại âm thanh cờ vua (cần Python + numpy + scipy)
scripts/blocks-sounds.py Tạo lại âm thanh Xếp Khối (cần Python + numpy + scipy)
scripts/build-openings.js Tạo lại sách khai cuộc từ bộ dữ liệu lichess
scripts/caro-sounds.py Tạo lại âm thanh cờ caro
scripts/farm-sounds.py Tạo lại âm thanh Nông trại; scripts/farm-icons.py chép hình Twemoji cho web và app
scripts/puzzles/     Tạo câu đố cho Cờ vua, Xếp Khối, Cờ caro (chess.js, blocks.js, caro.js; --add N để thêm màn)
scripts/apk-check/   Chạy thử APK trên máy ảo Android (run.py) và tạo dữ liệu thử (seed.py)
public/              Giao diện: index.html, app.css, app.js, localdb.js (lưu trên máy), sw.js (service worker),
                     games-ui.js (tab Trò chơi), chess-ui.js (Cờ vua), blocks-core.js + blocks.js + blocks.css (Xếp Khối),
                     blocks.html + blocks-page.js (trang Xếp Khối chơi offline), social-ui.js (trang cá nhân, bảng tin),
                     caro-core.js + caro-ui.js + caro.css (Cờ caro), farm-ui.js + farm.css (Nông trại),
                     streaks.js + streaks.css (chuỗi hằng ngày), chess-anim.js (quân cờ trượt),
                     puzzles-core.js (luật câu đố) + puzzles-ui.js + puzzles.css (quiz, thử thách), puzzles/ (dữ liệu câu đố),
                     voice-core.js + voice-ui.js (tin nhắn thoại: ghi âm, nghe),
                     theme.js (nền sáng/tối), chess/pieces/ (hình quân cờ), chess/sounds/, blocks/sounds/ (âm thanh),
                     farm/emoji/ (hình Twemoji), farm/sounds/
public/download/     File cài app Android (think.apk) và version.json
android/             Mã app Android: mở web bằng Chrome, bong bóng chat, trả lời trong thông báo (build.sh để build)
native/              App Think Beta (React Native / Expo), xem native/README.md
.github/workflows/   GitHub Actions: build và đăng file APK của App Think Beta, Kiểm tra APK trên máy ảo
deploy/              Mẫu cấu hình Caddy và Nginx
```

Phông chữ Be Vietnam Pro dùng giấy phép SIL Open Font License (xem `public/fonts/OFL.txt`). Hình biểu tượng Nông trại là Twemoji của Twitter / X và cộng đồng, giấy phép CC-BY 4.0 (xem `public/farm/emoji/LICENSE.txt`).
