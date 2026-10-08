# App Think Beta — app cài trên điện thoại (không phải web)

Đây là app Think viết lại bằng **React Native (Expo)**: giao diện là giao diện thật của điện thoại, không phải trang web mở trong khung. App nói chuyện với **cùng máy chủ Think** (thinkchat.id.vn), nên tin nhắn, tài khoản, nhóm… giống hệt bản web.

App có tên **Think Beta** (mã gói `com.nuwngc.think.beta`), cài **song song** với app Think hiện tại (bản có bong bóng chat). Dùng thử thấy ổn rồi mới tính chuyện thay thế.

## Có gì trong app

- Đăng nhập bằng tài khoản Think, lần đầu bắt buộc đặt mật khẩu mới.
- Danh sách chat: tìm không cần dấu, lọc Chưa đọc / Nhóm / Riêng tư, số tin chưa đọc. **Chạm giữ** một cuộc trò chuyện để **ghim lên đầu**, **tắt thông báo** (1 / 8 / 24 giờ hoặc đến khi bật lại), đánh dấu đã đọc.
- Chat: gửi chữ, **gửi ảnh** (chọn trong máy hoặc chụp, tự thu nhỏ), **trả lời tin**, **thả cảm xúc**, **thu hồi**, sao chép, xem ảnh lớn và **lưu/chia sẻ ảnh**, "đang nhập…", "Đã gửi / Đã xem", tin cũ tải thêm khi kéo lên.
- **Chat 2.1.0**: **sửa tin nhắn**, **ghim tin nhắn** (thanh ghim trên đầu), **tìm tin nhắn** (nút kính lúp), **chuyển tiếp**, **@nhắc tên** trong nhóm, **bình chọn** (nút ＋), nút ⓘ **Tùy chỉnh đoạn chat**: 12 **chủ đề màu**, **biểu tượng gửi nhanh** (ô nhập trống thì bấm là gửi 👍), tắt thông báo, ghim, **ảnh đã gửi**.
- **Bong bóng chat** (Cài đặt → Bong bóng chat, Android 8 trở lên): tin mới khi không mở app hiện thành ảnh người nhắn nổi trên màn hình như Messenger, chạm để mở **khung chat nhỏ** trả lời ngay, kéo xuống ✕ để ẩn. Khi bật, app chạy nền nên **máy không có dịch vụ Google (Huawei) vẫn nhận được thông báo** tin mới. Chi tiết ở mục 18 của README chính.
- Nhắn riêng, **tạo nhóm**, đổi tên nhóm, thêm / xóa người, rời nhóm.
- **Trang cá nhân + bảng tin** (tab Cá nhân): ảnh bìa, lời giới thiệu, số bài / lượt thích / ELO; đăng bài có chữ và ảnh, **thả tim**, **bình luận**, xem trang của người khác (có nút Nhắn tin, Thách cờ). Mục **Bảng tin** (cả nhóm) và **Bài của tôi**, cập nhật ngay không cần tải lại. Chi tiết ở mục 15 của README chính.
- **Cài đặt** (nút ⚙ ở trang cá nhân): đổi tên, lời giới thiệu, ảnh đại diện, **ảnh bìa**, **giao diện sáng / tối** (Theo máy, Nền sáng, Nền tối), bật/tắt thông báo, đổi mật khẩu (mục Bảo mật), kiểm tra bản mới.
- Quản trị (admin): tạo tài khoản (hiện mật khẩu tạm để gửi), đặt lại mật khẩu, khóa / mở khóa, cấp quyền admin, xem bộ nhớ máy chủ, tự dọn / dọn thủ công, **Báo lỗi app** (app tự gửi khi bị crash hay màn hình lỗi: tên máy, Android / HarmonyOS, bản app, chi tiết kỹ thuật).
- **Thông báo đẩy** khi đóng app, bấm **Trả lời** hoặc **Đã đọc** ngay trong thông báo (cần bước 3 bên dưới).
- **Lưu trên máy**: mở app là thấy ngay tin nhắn cũ kể cả khi máy chủ đang ngủ hoặc mất mạng, tự kết nối lại.
- **Tab Trò chơi**: trang chọn game (Nông trại, Xếp Khối, Cờ vua, Cờ caro) và bảng xếp hạng của cả nhóm.
- **Nông trại** (tab Trò chơi → Nông trại, mới ở 0.3.0): gieo hạt, thu hoạch theo thời gian thật, nuôi gà bò, **nấu mì cay, pha trà sữa trân châu**, nướng pizza…, giao đơn cho khách, bán ở chợ (giá đổi mỗi ngày, món hot), nâng kho, mua chó giữ vườn và đồ trang trí, lên cấp mở thêm cây và món, quà mỗi ngày. **Ghé vườn bạn bè** để bắt sâu giúp hoặc hái trộm, khung **"Khi bạn vắng nhà"** kể lại ai đã ghé, bảng xếp hạng cấp độ / xu tuần này. **Thông báo khi cả ruộng chín** (hẹn ngay trên máy), âm thanh, chữ bay lên. Dùng chung nông trại với bản web. Chi tiết ở mục 20 của README chính.
- **Xếp Khối** (kiểu Block Blast): kéo khối vào bàn 8×8, xóa hàng / cột, combo, hiệu ứng nổ, âm thanh, **chơi được khi mất mạng** (có nút chơi ngay ở màn đăng nhập / màn chờ máy chủ), điểm tự gửi lên **bảng xếp hạng** tuần này / mọi lúc khi có mạng. Chi tiết ở mục 16 của README chính.
- **Tin nhắn thoại** (mới ở 0.6.0): trong khung chat **giữ nút micro để nói, thả tay là gửi**, kéo ngón tay ra xa để hủy, chạm nhanh để ghi rảnh tay (nút Gửi / Hủy). Nghe có dạng sóng, chạm để tua, tốc độ 1× / 1,5× / 2×, phát xong tự phát tin kế tiếp. Lần đầu ghi app hỏi quyền micro. Chi tiết ở mục 23 của README chính.
- **Thành tựu** (mới ở 0.6.0): huy hiệu Đồng / Bạc / Vàng ở trang cá nhân, chạm để xem cách đạt. Chi tiết ở mục 24 của README chính.
- **Đóng băng chuỗi** ❄️ (mới ở 0.6.0): mỗi tuần 1 lượt (giữ tối đa 2), lỡ quên chơi một ngày thì tự dùng để giữ chuỗi; số lượt hiện ở khung chuỗi, bông tuyết trên lịch 7 ngày.
- **Quiz hằng ngày + Thử thách nhanh** (mới ở 0.5.0): Cờ vua, Xếp Khối, Cờ caro mỗi game một câu đố mỗi ngày cho cả nhóm và 200 màn thử thách (1–3 sao, bảng xếp hạng). Khung "Quiz hôm nay" ở tab Trò chơi, nút trong từng game. Dữ liệu câu đố đóng gói sẵn (chơi được khi mất mạng); máy chủ thêm màn thì app tự tải về. Chi tiết ở mục 22 của README chính.
- **Chuỗi hằng ngày** (mới ở 0.4.0): mỗi game có chuỗi ngày chơi liên tiếp 🔥 riêng và một chuỗi chung; khung chuỗi ở đầu tab Trò chơi, nhãn "🔥 5 ngày" trên từng thẻ game (vàng "sắp đứt" khi hôm nay chưa chơi), huy hiệu trong từng game, bảng chuỗi (lịch 7 ngày, kỷ lục, mốc), chúc mừng khi đạt mốc, nhắc giữ chuỗi buổi tối. Xếp Khối và cờ caro với máy chơi lúc mất mạng vẫn được tính. Chi tiết ở mục 21 của README chính.
- **Think AI và gọi điện 0.11.0**: **Think AI** — trợ lý AI như Meta AI: nút bút chì → **Hỏi Think AI** để nhắn riêng (có câu hỏi gợi ý, gửi ảnh nhờ xem giúp), hoặc gõ **@** chọn **Think AI** trong nhóm / phòng chung. **Gọi thoại, gọi video** trong chat riêng (nút 📞 🎥 trên đầu khung chat; Tìm tin nhắn và Thách cờ chuyển vào ⓘ Tùy chỉnh đoạn chat): chuông + rung khi có người gọi, thông báo "Đang gọi cho bạn" khi app đóng (kênh **Cuộc gọi đến**), tắt micro, tắt / đổi máy ảnh, **loa ngoài**, gọi thoại áp tai thì màn hình tự tắt, chuyển sang app khác vẫn nói chuyện được (thông báo "Đang gọi…" có nút Kết thúc), nhật ký cuộc gọi + nút **Gọi lại**. Gọi chéo được với bản web. Admin: **Quản trị → AI, gọi** (khóa API Think AI, máy chủ TURN). Chi tiết ở mục 25, 26 của README chính. Bản này thêm thư viện gọi điện (WebRTC) nên cần cài APK mới.
- **Gọi nhóm 0.12.0**: nút **Gọi nhóm** / **Gọi video nhóm** trên đầu khung chat nhóm (tối đa 8 người), màn hình cuộc gọi nhóm đến ("An đang gọi nhóm" → **Tham gia** / **Từ chối**), lưới ô từng người (micro tắt, máy ảnh tắt hiện ảnh đại diện, "Đang kết nối…"), nút **Rời**; nhóm đang gọi thì khung chat có thanh **"… người đang gọi" + Tham gia** và danh sách có biểu tượng 📞. Sửa lỗi cuộc gọi kẹt ở **"Đang kết nối…"**: dùng máy chủ chuyển tiếp TURN (tự dùng Open Relay khi admin chưa cài TURN riêng), app giữ kết nối với máy chủ khi chạy nền trong lúc gọi. Admin: **Quản trị → AI, gọi → Cuộc gọi: máy chủ chuyển tiếp (TURN)** (Metered, ExpressTURN, Cloudflare) và **Cuộc gọi gần đây** (nối được qua TURN hay đi thẳng). Chi tiết ở mục 26 của README chính. Cần cài APK 0.12.
- **Kèo, hẹn giờ gửi, công thức 0.17.0**: nút **＋** cạnh ô nhập có thêm **Tạo kèo** (tên, giờ, địa điểm; thẻ kèo trong chat có nút **Đi / Có thể / Không đi**, Think nhắc trước giờ hẹn 1 tiếng), **Hẹn giờ gửi tin** (chọn giờ, thanh "tin hẹn giờ" trên ô nhập để **Gửi ngay** / **Hủy**) và **Công thức toán, hóa** (bàn phím ký hiệu √ π ≤ → ⇌ ₂ ²⁺…; gõ `x^2` thành x², `H_2O` thành H₂O). Chi tiết ở mục 28–30 của README chính. Cần cài APK 0.17.
- **Đổi tên / ảnh nhóm 0.16.0**: ⓘ Tùy chỉnh đoạn chat có nút **Đổi tên**, **Đổi ảnh**, **Xóa ảnh** ngay dưới tên nhóm (chạm ảnh nhóm cũng đổi được). Phòng chung "Cả nhóm": admin đổi được tên và ảnh. Cần cài APK 0.16.
- **Think AI giúp đọc chat 0.15.0**: mở nhóm có từ 10 tin chưa đọc thì có dòng **"… tin chưa đọc — để Think AI tóm tắt giúp?"** → **Tóm tắt** (chỉ bạn thấy); ⓘ Tùy chỉnh đoạn chat → **Tóm tắt tin gần đây**. Chạm giữ một tin → **Dịch (Think AI)**: bản dịch hiện dưới tin. Sửa: tên "Tin của bạn" trên hàng tin 24 giờ không còn bị cắt; bỏ cảnh báo "radius: Null" của bàn cờ trên Android. Chi tiết ở mục 25 của README chính. Cần cài APK 0.15.
- **Tin 24 giờ 0.14.0**: hàng vòng tròn trên đầu danh sách chat (**Thêm tin**, tin của bạn, tin của mọi người — viền xanh – vàng là có tin chưa xem). Đăng chữ trên nền màu hoặc ảnh kèm chú thích, tự mất sau 24 giờ. Xem toàn màn hình: chạm phải / trái để tới / lùi, giữ để dừng, nút Back để đóng; thả cảm xúc hoặc trả lời thành tin nhắn riêng (có ảnh nhỏ của tin trong chat). Tin của mình: xem ai đã xem, xóa tin. Chi tiết ở mục 27 của README chính. Cần cài APK 0.14.
- **Think AI dùng Cerebras 0.13.0**: Quản trị → AI, gọi → Dịch vụ AI có thêm **Cerebras** (trả lời rất nhanh), kèm cách lấy khóa và nút chọn model (`qwen-3.8-27b` xem được ảnh, `gpt-oss-120b` nhanh hơn). Chi tiết ở mục 25 của README chính. Admin nên dùng app 0.13 hoặc bản web để đổi dịch vụ AI.
- **Chat 0.10.0**: **đổi ảnh nhóm** (Thông tin nhóm → chạm ảnh / Đổi ảnh nhóm, Xóa ảnh), đổi tên nhóm; **khóa cuộc trò chuyện bằng mật khẩu** (Tùy chỉnh đoạn chat → Khóa bằng mật khẩu): thông báo và bong bóng chat vẫn đầy đủ, bấm vào (hay mở từ danh sách) thì phải nhập mật khẩu, danh sách không hiện nội dung tin, nút ổ khóa trên đầu khung chat khóa lại ngay, để app chạy nền quá 2 phút thì tự khóa lại, quên mật khẩu thì bỏ khóa bằng mật khẩu đăng nhập. Chi tiết ở mục 18 của README chính.
- **Cờ vua 0.9.0**: **Giải đấu vòng tròn** giữa bạn bè (mục Giải đấu → Tạo giải: mời 2–7 người, 1 / 2 / 3 / 7 ngày mỗi nước, bảng xếp hạng điểm + hệ số SB, nhà vô địch 🏆, thông báo mời / bắt đầu / kết thúc mở thẳng trang giải), **Bạn bè đang đánh** (chạm để xem), **đi trước** (premove: chọn sẵn nước khi đối thủ đang nghĩ, ô tô xanh, chạm để bỏ; tắt trong Tùy chọn bàn cờ), **Xin đi lại** trong ván giao hữu với bạn, **Chép PGN** của ván đã xong, **Dán PGN / Chép PGN** ở bàn phân tích.
- **Cờ vua 0.8.0**: **Bàn phân tích** (Stockfish: thanh đánh giá, mũi tên, 3 dòng nước hay nhất, chạm để đi; mở từ trang Cờ vua, từ ván đã xong, từ Hai người một máy), **cờ theo ngày** khi thách đấu (1 / 2 / 3 / 7 ngày mỗi nước), **Thống kê** (biểu đồ ELO chạm xem từng ván, thắng / hòa / thua, đối đầu, khai cuộc; chạm người trong bảng xếp hạng để xem của họ), **6 màu bàn cờ**, **Nói nhanh** với bạn trong ván.
- **Cờ vua 0.7.0**: **18 máy cờ có tính cách** chia 4 nhóm (Mầm Non ~250 → Stockfish ~3000) và **máy tự chọn sức** 300–2800, máy nói chuyện trong bong bóng cạnh tên, nút **Gợi ý** (mũi tên nước nên đi) và **Đi lại**, **vương miện** 👑 cho máy đã thắng không cần trợ giúp, **tên khai cuộc** trong ván, chế độ **Hai người một máy** (không cần mạng, tự xoay bàn cờ). Sửa lỗi phong cấp làm Xe hiện lại ô cũ che mất Hậu.
- **Cờ vua** (tab Trò chơi → Cờ vua): thách đấu bạn bè có chọn thời gian, đồng hồ, **điểm ELO**, **bảng xếp hạng**, chơi với máy (có Stockfish), thông báo khi có người thách hoặc tới lượt đi, **quân trượt mượt và kéo thả bằng ngón tay như chess.com** (tắt được trong Tùy chọn bàn cờ), **lịch sử và xem lại ván** (tự chạy), **đánh giá ván kiểu Game Review** (Thiên tài !!, Tuyệt vời !, Tốt nhất, Theo sách, Sai lầm ??…, thanh đánh giá, huy hiệu trên bàn cờ, nhận xét từng nước, xem nước tốt nhất, bảng tổng kết, tên khai cuộc), **bật/tắt chỉ dẫn** và **âm thanh** quân gỗ (nước mình / đối thủ khác tiếng, sắp hết giờ, đi sai), **chia sẻ ván** lên trang cá nhân hoặc vào cuộc trò chuyện (hiện thành thẻ bấm được để mở ván). Trong chat riêng có nút quân mã để thách nhanh. Chơi chéo được với người dùng bản web. Chi tiết ở mục 14 của README chính.
- **Cờ caro** (tab Trò chơi → Cờ caro): bàn 15×15 kiểu giấy kẻ ô, 5 quân liền là thắng, luật **tự do** hoặc **chặn hai đầu**. **Chơi với máy** (Dễ / Vừa / Khó, chạy hẳn trên điện thoại, không cần mạng, ván dở được lưu để chơi tiếp, có Đi lại / Đổi bên, thành tích theo từng mức). **Thách đấu bạn bè** (15 / 30 / 60 / 120 giây mỗi nước hoặc không giới hạn, chọn bên, tính / không tính **điểm ELO**), nước đi hiện ngay, đồng hồ mỗi nước theo giờ máy chủ, đầu hàng, đấu lại, **bảng xếp hạng**, thông báo khi có người thách hoặc tới lượt. Chạm một ô để xem trước quân mờ, chạm lại để đánh. Có âm thanh (tắt được) và pháo giấy khi thắng. Chơi chéo được với người dùng bản web.
- Giao diện sáng / tối theo máy hoặc tự chọn trong Cài đặt. Chạy từ Android 7 trở lên.

Từ bản này app đã có **bong bóng chat nổi** như app Think cũ, nên có thể dùng Think Beta thay hẳn app cũ.

Mỗi lần sửa code trong `native/`, GitHub tự **chạy thử bản APK trên máy ảo Android 10 và Android 14** (workflow **Kiểm tra APK**, xem mục 19 của README chính) để bắt lỗi crash trước khi phát hành.

---

## Xuất bản (làm trên điện thoại, không cần máy tính)

App được build tự động trên **GitHub Actions** (miễn phí với repo công khai), không cần tài khoản Expo hay Android Studio. Mỗi lần build xong, file cài `think-app.apk` nằm trong mục **Releases** của repo.

### Bước 1. Đưa code lên GitHub

Giống các lần cập nhật trước, trong Termux:

```bash
cd ~ && unzip -o ~/storage/downloads/think-chat.zip
cd ~/think-chat
git add -A && git commit -m "App Think Beta" && git push
```

### Bước 2. Thêm mã mở khóa ký app (làm một lần)

File `native/credentials/signing.tgz.enc` là **khóa ký app đã được khóa lại**, để GitHub ký APK giống hệt nhau mỗi lần (nhờ vậy bản mới cài đè được bản cũ). GitHub cần mã để mở nó:

1. Mở repo trên GitHub (trình duyệt điện thoại, bật "Trang web cho máy tính" nếu thấy thiếu menu).
2. **Settings → Secrets and variables → Actions → New repository secret**.
3. Name: `THINK_SIGNING_KEY` — Secret: dán mã mở khóa (mã được gửi riêng cho bạn, **không đăng lên đâu cả**).
4. Bấm **Add secret**.

### Bước 3 (nên làm). Bật thông báo đẩy

Máy chủ gửi thông báo qua Firebase Cloud Messaging, dùng luôn **project Firebase đang sao lưu dữ liệu cho Think** (biến `FIREBASE_SERVICE_ACCOUNT` trên Render). Chỉ cần đăng ký app với Firebase:

1. Vào console.firebase.google.com → mở đúng project của Think.
2. Bấm biểu tượng bánh răng → **Project settings** → mục **Your apps** → **Add app** → chọn **Android**.
3. **Android package name**: `com.nuwngc.think.beta` (gõ đúng từng chữ). Các ô khác bỏ trống → **Register app**.
4. Bấm **Download google-services.json**. Mở file vừa tải, **chép toàn bộ nội dung**.
5. Trên GitHub: **Settings → Secrets and variables → Actions → New repository secret** — Name: `GOOGLE_SERVICES_JSON`, Secret: dán nội dung file → **Add secret**.
6. Trên Render không cần đổi gì. Sau lần deploy tới, log máy chủ có dòng `📱 Thông báo cho app Think (Firebase Cloud Messaging): đã bật`.

Không làm bước này thì app vẫn chạy bình thường, chỉ là **đóng app sẽ không có thông báo** (tab Cá nhân sẽ ghi rõ).

> Nếu Firebase báo lỗi thông báo: vào **Project settings → Cloud Messaging**, kiểm tra **Firebase Cloud Messaging API (V1)** đang **Enabled**.

### Bước 4. Build

- Mỗi lần `git push` có thay đổi trong thư mục `native/`, GitHub tự build.
- Hoặc bấm tay: repo → tab **Actions** → **App Think (Android)** → **Run workflow** (ô *Ghi chú* là dòng hiện trong app khi báo có bản mới).
- Build mất khoảng **20–30 phút** (lần đầu lâu hơn). Dấu tích xanh là xong, dấu X đỏ là lỗi (bấm vào để xem bước nào lỗi).

### Bước 5. Cài app

- Repo → **Releases** (cột bên phải, hoặc `https://github.com/Nuwngc/Think/releases/latest`) → tải **think-app.apk** → mở file để cài.
- Android hỏi "Cho phép cài ứng dụng không rõ nguồn gốc" thì bật cho trình duyệt / trình quản lý file đang dùng.
- Gửi link `https://github.com/Nuwngc/Think/releases/latest/download/think-app.apk` cho bạn bè để họ cài.

### Cập nhật về sau

Sửa code trong `native/` → push → GitHub build bản mới (số phiên bản tự tăng). App trên máy mọi người tự hiện dòng **"Có bản app mới … Tải về"** (kiểm tra 6 tiếng một lần, hoặc bấm **Cá nhân → Kiểm tra bản mới**). Tải về cài đè, không mất đăng nhập.

Mẹo: trên Render, mục **Settings → Build & Deploy → Build Filters → Ignored Paths**, thêm `native/**` và `.github/**` để sửa app không làm máy chủ khởi động lại.

---

## Lỗi thường gặp

| Hiện tượng | Cách xử lý |
|---|---|
| Actions báo "Chưa có secret THINK_SIGNING_KEY" | Làm bước 2. |
| Bước **Ký APK** lỗi `bad decrypt` | Mã `THINK_SIGNING_KEY` dán sai (thừa dấu cách / xuống dòng). Sửa lại secret rồi **Re-run jobs**. |
| Bước **Cấu hình Firebase** báo không có app `com.nuwngc.think.beta` | Trong Firebase thêm app Android đúng tên gói (bước 3), tải lại file và dán lại secret. |
| Cài báo "Ứng dụng chưa được cài đặt" | Máy đang có bản ký bằng khóa khác, hoặc bản mới có số nhỏ hơn. Gỡ Think Beta cũ rồi cài lại. |
| Đăng nhập chờ lâu | Máy chủ Render miễn phí đang ngủ, cần tới 1 phút để thức dậy. Đừng tắt app. |
| Không có thông báo khi đóng app | Cá nhân → Thông báo tin nhắn mới phải đang bật. Cài đặt điện thoại → Pin → cho Think Beta chạy nền không giới hạn (máy Xiaomi/Oppo/Vivo: bật thêm **Tự khởi chạy**). |
| Thông báo đến nhưng không có nút Trả lời | Mở app một lần sau khi cài (app tạo kênh thông báo và nút lúc mở). |
| Máy Huawei (không có dịch vụ Google) không có thông báo | Bật **Cài đặt → Bong bóng chat**: app chạy nền và tự hiện thông báo + bong bóng khi có tin mới. Cài đặt điện thoại → Pin → Khởi chạy ứng dụng → Think Beta: **Quản lý thủ công**, bật cả 3 mục. |
| Bật bong bóng chat không được / bong bóng không hiện | Cho Think Beta quyền **Hiển thị trên ứng dụng khác** (Cài đặt điện thoại → Ứng dụng → Think Beta). Bong bóng chỉ hiện khi **không mở app** và cuộc trò chuyện không bị tắt thông báo. Bấm **Thử bong bóng** trong Cài đặt để xem thử. |
| App bị tắt đột ngột | App tự gửi báo lỗi, admin xem ở **Quản trị → Báo lỗi app**. Lần mở sau báo lỗi mới được gửi đi (nếu lúc tắt không có mạng). |

---

## Dành cho người sửa code

```text
native/
  App.tsx, index.ts        Điểm vào; index.ts nạp tác vụ nền (nút trong thông báo) trước
  app.config.ts            Tên app, mã gói, biểu tượng, quyền, cấu hình build
  src/store.ts             Dữ liệu của app, kết nối realtime (Socket.IO), đăng nhập, gửi tin…
  src/api.ts               Gọi API máy chủ Think (mã phiên gửi trong header Authorization)
  src/notifications.ts     Thông báo đẩy, nút Trả lời / Đã đọc
  src/chatPlus.ts, src/chatThemes.ts  Chat 2.1.0: chủ đề, biểu tượng nhanh, tắt thông báo, @nhắc tên, bình chọn (hàm thuần, có kiểm thử)
  src/bubbles.ts           Bong bóng chat: bật / xin quyền, hiện bong bóng khi có tin mới lúc app chạy nền, giữ kết nối
  src/bubble/BubbleApp.tsx Khung chat nổi khi chạm bong bóng (màn hình "ThinkBubble")
  src/errors.ts            Báo lỗi app tự động (lỗi JavaScript, màn hình lỗi, gửi lỗi crash đã lưu)
  modules/think-native/    Phần Android viết bằng Kotlin: bắt crash (CrashCatcher), bong bóng chat (ChatHeadService,
                           BubbleActivity, ChatHeads), cuộc gọi (CallAudio: loa, chế độ gọi; CallService: dịch vụ chạy nền
                           khi đang gọi); tự được Expo nối vào app khi build
  src/background.ts        Tác vụ nền khi bấm nút trong thông báo lúc app đã tắt
  src/cache.ts             Lưu bản sao trên máy để mở app nhanh / khi mất mạng
  src/format.ts            Chữ, giờ, tin hệ thống — giống bản web
  src/screens/             Các màn hình (ChatLock.tsx: màn nhập mật khẩu + phần khóa trong Tùy chỉnh đoạn chat)
  src/chatLock.ts          Khóa cuộc trò chuyện: chặn khi chưa mở khóa, tự khóa lại sau 2 phút — giống bản web
  src/calls/               Gọi thoại / gọi video / gọi nhóm: engine.ts (mời gọi, nghe máy, WebRTC nhiều người — giống public/calls-ui.js),
                           CallScreen.tsx (màn hình cuộc gọi, lưới gọi nhóm), rtc.tsx (react-native-webrtc) + rtc.web.tsx (bản trình
                           duyệt), sound.ts (chuông, tiếng tút); cài TURN trong Quản trị: src/screens/TurnSettings.tsx
  src/ai/                  Think AI giúp đọc chat: help.ts (gợi ý / tóm tắt / dịch), AiSummaryBar.tsx, TranslationBox.tsx
  src/plans/               Kèo, hẹn giờ gửi tin: core.ts (chữ giờ hẹn, giống public/plans-core.js), store.ts, EventCard.tsx, Sheets.tsx
  src/formula/             Công thức toán, hóa: core.ts (giống public/formula-core.js), FormulaText.tsx (x², H₂O), FormulaPad.tsx (bàn phím ký hiệu)
  src/stories/             Tin 24 giờ: store.ts (dữ liệu, xem / chuyển tin), StoryBar.tsx (hàng vòng tròn), StoryViewer.tsx,
                           StoryComposer.tsx, StoryRefCard.tsx (khung "Đã trả lời tin" trong chat), bgs.ts (màu, giống web)
  src/games/               Tab Trò chơi (trang chọn game); registry.ts: danh sách mã game (game nào cũng phải có chuỗi)
  src/puzzles/             Quiz hằng ngày + Thử thách nhanh: core.ts (luật, giống public/puzzles-core.js), store.ts (tiến độ, hàng chờ),
                           data.ts + data/ (câu đố đóng gói, tải bản mới từ máy chủ), LevelMap, PuzzleScreen, bàn cờ từng game
  src/streaks/             Chuỗi hằng ngày: store.ts (tải, realtime, hàng chờ ngày chơi lúc mất mạng), logic.ts, ui.tsx (khung, nhãn, bảng)
  src/blocks/              Xếp Khối: engine.ts (luật, giống public/blocks-core.js), store.ts (lưu trên máy, gửi điểm), BlocksScreen.tsx
  src/chess/               Cờ vua: bàn cờ (Board.tsx: lớp quân trượt + kéo thả, anim.ts: quân nào trượt đi đâu, layout.ts: ghép quân giữ thứ tự vẽ), LocalGame.tsx + local.ts: hai người một máy, AnalysisBoard.tsx + analysisBoard.ts: bàn phân tích, Stats.tsx: thống kê, Tournament.tsx: giải đấu, premove.ts: đi trước, pgn.ts: đọc / ghi PGN, ván cờ,
                           thách đấu, bảng xếp hạng, đánh giá ván (luật: chess.js)
  src/caro/                Cờ caro: engine.ts (luật + máy, giống public/caro-core.js), store.ts (thách đấu, ván với máy lưu trên máy), bàn cờ, các màn
  src/farm/                Nông trại: store.ts (dữ liệu, gửi thao tác lên máy chủ), logic.ts (hàm thuần), FarmScreen.tsx + các mục
                           (Field, Build, Orders, Storage, Friends, Sheets), notify.ts (báo khi ruộng chín), icons.ts (hình Twemoji,
                           tạo bằng scripts/farm-icons.py, ảnh trong assets/farm/)
  src/social/              Trang cá nhân, bảng tin, bình luận, chia sẻ ván cờ (store.ts: dữ liệu; SocialHost.tsx: các bảng)
  src/theme.ts             Màu sáng / tối và lựa chọn giao diện (lưu trên máy)
  credentials/             Khóa ký app đã khóa (không có mã thì không mở được)
  tests/                   Kiểm thử (npm test)
```

Kiểm tra trước khi push: `npm install` rồi `npm run check && npm run lint && npm test && npm run check:native` (lệnh cuối so phiên bản các thư viện native với bản Expo — lệch phiên bản là nguyên nhân crash ở bản 0.1.4 / 0.1.5).

Chạy thử giao diện trên máy tính (trình duyệt), trỏ vào máy chủ Think chạy ở máy mình:

```bash
# Cửa sổ 1 — máy chủ Think (thư mục gốc), cho phép trang web của Expo gọi API
CORS_ORIGINS=http://localhost:8081 npm start
# Cửa sổ 2 — app
cd native && npm install
EXPO_PUBLIC_THINK_API_URL=http://localhost:3000 npx expo start --web
```

Máy chủ cho app dùng các API sẵn có của Think, thêm:

- `POST /api/login` với `{"client":"app"}`: trả về `token` (không dùng cookie). Các API khác nhận `Authorization: Bearer <token>`; Socket.IO nhận `auth: { token }`.
- `POST /api/app/push` / `POST /api/app/push/remove`: đăng ký / hủy mã FCM của máy. Mã gắn với phiên đăng nhập: đăng xuất, đổi mật khẩu, bị khóa là tự xóa.
- Gửi tin với cùng `clientId` hai lần (mạng chập chờn) chỉ tạo một tin.

### Khi muốn app này thay app Think cũ

Đổi `package` trong `app.config.ts` thành `com.nuwngc.think`, tên thành `Think`, và đặt `VERSION_OFFSET` trong `.github/workflows/android-app.yml` để số phiên bản lớn hơn app cũ (app cũ đang là 3). Khóa ký đã là khóa của app cũ nên sẽ cài đè được. Trong Firebase thêm app Android `com.nuwngc.think` và cập nhật secret `GOOGLE_SERVICES_JSON`.

### Bảo mật

- **Không** đưa lên GitHub: `google-services.json`, file `.jks`, mật khẩu khóa ký (đã có trong `.gitignore`).
- `credentials/signing.tgz.enc` được mã hóa AES-256 bằng mã 32 ký tự ngẫu nhiên, chỉ nằm trong GitHub Secrets và trong tay chủ repo. Lộ mã này thì phải đổi khóa ký.
- Bản gốc khóa ký vẫn là file `think-release.jks` trong gói `think-android-key.zip` — giữ kỹ.
