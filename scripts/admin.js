#!/usr/bin/env node
'use strict';
// Công cụ dòng lệnh cho chủ server (dùng khi quên mật khẩu admin, không vào được web)
//   npm run admin -- list
//   npm run admin -- reset-password <tên_đăng_nhập> [mật_khẩu_mới]
//   npm run admin -- make-admin <tên_đăng_nhập>
const path = require('node:path');
try { process.loadEnvFile(path.join(__dirname, '..', '.env')); } catch { /* không có .env */ }
const { get, all, run } = require('../src/db');
const auth = require('../src/auth');

const [command, username, newPassword] = process.argv.slice(2);

function findUser(name) {
  const user = get('SELECT * FROM users WHERE username = ?', String(name || '').toLowerCase());
  if (!user) {
    console.error(`❌ Không có tài khoản "${name}". Xem danh sách: npm run admin -- list`);
    process.exit(1);
  }
  return user;
}

(async () => {
  if (command === 'list') {
    const users = all('SELECT id, username, display_name, role, disabled FROM users ORDER BY id');
    for (const u of users) {
      console.log(`${String(u.id).padStart(3)}  ${u.username.padEnd(20)} ${u.display_name}${u.role === 'admin' ? '  [admin]' : ''}${u.disabled ? '  [đã khóa]' : ''}`);
    }
    return;
  }
  if (command === 'reset-password') {
    const user = findUser(username);
    if (newPassword && newPassword.length < 6) {
      console.error('❌ Mật khẩu cần ít nhất 6 ký tự.');
      process.exit(1);
    }
    const password = newPassword || auth.generatePassword(10);
    run('UPDATE users SET password_hash = ?, must_change_password = ?, disabled = 0 WHERE id = ?',
      await auth.hashPassword(password), newPassword ? 0 : 1, user.id);
    auth.deleteUserSessions(user.id);
    console.log(`✅ Đã đặt lại mật khẩu cho ${user.username}: ${password}`);
    if (!newPassword) console.log('   Đăng nhập xong app sẽ yêu cầu đổi mật khẩu.');
    return;
  }
  if (command === 'make-admin') {
    const user = findUser(username);
    run("UPDATE users SET role = 'admin', disabled = 0 WHERE id = ?", user.id);
    console.log(`✅ ${user.username} giờ là admin.`);
    return;
  }
  console.log(`Cách dùng:
  npm run admin -- list
  npm run admin -- reset-password <tên_đăng_nhập> [mật_khẩu_mới]
  npm run admin -- make-admin <tên_đăng_nhập>`);
})();
