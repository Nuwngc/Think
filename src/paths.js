'use strict';
// Đường dẫn thư mục dữ liệu, dùng chung cho mọi module (đọc sau khi đã nạp .env)
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.resolve(ROOT, process.env.DATA_DIR || 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

module.exports = {
  ROOT,
  DATA_DIR,
  UPLOAD_DIR,
  AVATAR_DIR: path.join(UPLOAD_DIR, 'avatars'),
  IMAGE_DIR: path.join(UPLOAD_DIR, 'img'),
};
