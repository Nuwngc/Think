/* Giao diện sáng / tối: chạy sớm trong <head> để trang không bị nháy màu khi mở.
   Lưu lựa chọn trên máy này ("system" = theo điện thoại/máy tính). */
(function () {
  var KEY = 'theme';
  var LIGHT = '#ffffff';
  var DARK = '#16211d';
  function read() {
    try {
      var t = localStorage.getItem(KEY);
      return t === 'light' || t === 'dark' ? t : 'system';
    } catch (e) {
      return 'system';
    }
  }
  function apply(mode) {
    var root = document.documentElement;
    if (mode === 'light' || mode === 'dark') root.setAttribute('data-theme', mode);
    else root.removeAttribute('data-theme');
    // Màu thanh trạng thái / thanh địa chỉ theo giao diện đang chọn
    var metas = document.querySelectorAll('meta[name="theme-color"]');
    for (var i = 0; i < metas.length; i++) {
      var m = metas[i];
      var dark = /dark/.test(m.getAttribute('media') || '');
      var color = mode === 'light' ? LIGHT : mode === 'dark' ? DARK : dark ? DARK : LIGHT;
      if (!root.classList.contains('auth-mode')) m.setAttribute('content', color);
      m.setAttribute('data-base', color);
    }
  }
  apply(read());
  window.ThinkTheme = {
    get: read,
    set: function (mode) {
      try {
        if (mode === 'light' || mode === 'dark') localStorage.setItem(KEY, mode);
        else localStorage.removeItem(KEY);
      } catch (e) { /* chế độ ẩn danh */ }
      apply(read());
    },
  };
})();
