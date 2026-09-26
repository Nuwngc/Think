'use strict';
// Điểm khởi động (npm start). Nếu có cấu hình Firebase thì tải dữ liệu về trước, rồi mới chạy server.
const path = require('node:path');

try {
  process.loadEnvFile(path.join(__dirname, '.env'));
} catch {
  /* không có .env thì dùng mặc định */
}

const cloud = require('./src/cloud');

(async () => {
  if (cloud.init()) {
    console.log('☁️  Đang kết nối Firebase…');
    await cloud.restoreAll();
  }
  require('./server.js');
})().catch((err) => {
  console.error(`\n❌ ${err.message}\n`);
  process.exit(1);
});
