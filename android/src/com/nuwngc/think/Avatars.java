package com.nuwngc.think;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.BitmapShader;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Rect;
import android.graphics.RectF;
import android.graphics.Shader;
import android.graphics.Typeface;
import android.graphics.drawable.Icon;

import java.io.File;
import java.io.FileOutputStream;
import java.util.Locale;

/** Ảnh đại diện cho thông báo và bong bóng chat: tải và giữ lại trên máy, hoặc vẽ chữ cái đầu. */
final class Avatars {
    /** Cùng bảng màu với web (AVATAR_COLORS trong public/app.js). */
    private static final int[] COLORS = {
        0xFF2F6F8F, 0xFF8A4FA3, 0xFFB4533C, 0xFF3E7D4F, 0xFFA0527A, 0xFF5160C4, 0xFFB86F1F, 0xFF2B8585,
    };
    private static final int SIZE = 192;          // ảnh tròn cho người gửi
    private static final int ADAPTIVE = 216;      // ảnh 108dp cho bong bóng/lối tắt (phần thấy được là 144 ở giữa)
    private static final int MAX_BYTES = 3 * 1024 * 1024;

    private Avatars() {}

    /** Ảnh gốc đã lưu trên máy, hoặc tải về nếu cho phép dùng mạng. null nếu chưa có. */
    static Bitmap photo(Context context, String path, boolean network) {
        if (path == null || path.isEmpty() || !path.startsWith("/uploads/avatars/")) return null;
        File dir = new File(context.getCacheDir(), "avatars");
        String name = path.substring(path.lastIndexOf('/') + 1).replaceAll("[^A-Za-z0-9._-]", "_");
        File file = new File(dir, name);
        if (!file.exists()) {
            if (!network) return null;
            try {
                byte[] data = Http.download(Config.ORIGIN + path, MAX_BYTES);
                if (!dir.exists() && !dir.mkdirs()) return null;
                File tmp = new File(dir, name + ".tmp");
                FileOutputStream out = new FileOutputStream(tmp);
                try {
                    out.write(data);
                } finally {
                    out.close();
                }
                if (!tmp.renameTo(file)) return null;
            } catch (Exception e) {
                return null;
            }
        }
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeFile(file.getPath(), bounds);
        int sample = 1;
        while (bounds.outWidth / (sample * 2) >= SIZE && bounds.outHeight / (sample * 2) >= SIZE) sample *= 2;
        BitmapFactory.Options opts = new BitmapFactory.Options();
        opts.inSampleSize = sample;
        return BitmapFactory.decodeFile(file.getPath(), opts);
    }

    static int colorOf(long id) {
        return COLORS[(int) (Math.abs(id) % COLORS.length)];
    }

    static String initialOf(String name) {
        String s = name == null ? "" : name.trim();
        if (s.isEmpty()) return "?";
        int cp = s.codePointAt(0);
        return new String(Character.toChars(cp)).toUpperCase(new Locale("vi"));
    }

    /** Ảnh tròn cho người gửi trong thông báo. */
    static Icon personIcon(Context context, String avatarPath, String name, long id, boolean network) {
        Bitmap photo = photo(context, avatarPath, network);
        Bitmap out = Bitmap.createBitmap(SIZE, SIZE, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(out);
        if (photo != null) drawCircle(canvas, photo, new RectF(0, 0, SIZE, SIZE));
        else drawLetterCircle(canvas, name, colorOf(id), new RectF(0, 0, SIZE, SIZE));
        return Icon.createWithBitmap(out);
    }

    /** Ảnh cho bong bóng và lối tắt của cuộc trò chuyện (adaptive icon, máy tự cắt hình tròn). */
    static Icon conversationIcon(Context context, boolean isGroup, String avatarPath, String name, long id, boolean network) {
        Bitmap out = Bitmap.createBitmap(ADAPTIVE, ADAPTIVE, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(out);
        int pad = (ADAPTIVE - 144) / 2;
        Rect inner = new Rect(pad, pad, pad + 144, pad + 144);
        if (isGroup) {
            // Giống ảnh nhóm trên web: màu theo mã nhóm, chữ cái đầu của tên nhóm
            canvas.drawColor(colorOf(id + 3));
            drawLetter(canvas, name, new RectF(inner));
        } else {
            Bitmap photo = photo(context, avatarPath, network);
            if (photo != null) {
                canvas.drawColor(averageColor(photo));
                Rect src = centerSquare(photo);
                Paint p = new Paint(Paint.FILTER_BITMAP_FLAG | Paint.ANTI_ALIAS_FLAG);
                canvas.drawBitmap(photo, src, inner, p);
            } else {
                canvas.drawColor(colorOf(id));
                drawLetter(canvas, name, new RectF(inner));
            }
        }
        return Icon.createWithAdaptiveBitmap(out);
    }

    private static Rect centerSquare(Bitmap b) {
        int s = Math.min(b.getWidth(), b.getHeight());
        int x = (b.getWidth() - s) / 2;
        int y = (b.getHeight() - s) / 2;
        return new Rect(x, y, x + s, y + s);
    }

    private static int averageColor(Bitmap b) {
        Bitmap one = Bitmap.createScaledBitmap(b, 1, 1, true);
        int c = one.getPixel(0, 0);
        return Color.rgb(Color.red(c), Color.green(c), Color.blue(c));
    }

    private static void drawCircle(Canvas canvas, Bitmap photo, RectF dst) {
        Rect src = centerSquare(photo);
        Bitmap square = Bitmap.createBitmap(photo, src.left, src.top, src.width(), src.height());
        Bitmap scaled = Bitmap.createScaledBitmap(square, (int) dst.width(), (int) dst.height(), true);
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        p.setShader(new BitmapShader(scaled, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP));
        canvas.save();
        canvas.translate(dst.left, dst.top);
        canvas.drawOval(new RectF(0, 0, dst.width(), dst.height()), p);
        canvas.restore();
    }

    private static void drawLetterCircle(Canvas canvas, String name, int color, RectF dst) {
        Paint bg = new Paint(Paint.ANTI_ALIAS_FLAG);
        bg.setColor(color);
        canvas.drawOval(dst, bg);
        drawLetter(canvas, name, dst);
    }

    private static void drawLetter(Canvas canvas, String name, RectF dst) {
        Paint text = new Paint(Paint.ANTI_ALIAS_FLAG);
        text.setColor(Color.WHITE);
        text.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.BOLD));
        text.setTextAlign(Paint.Align.CENTER);
        text.setTextSize(dst.height() * 0.44f);
        Paint.FontMetrics fm = text.getFontMetrics();
        float y = dst.centerY() - (fm.ascent + fm.descent) / 2f;
        canvas.drawText(initialOf(name), dst.centerX(), y, text);
    }
}
