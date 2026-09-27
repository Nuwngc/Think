package com.nuwngc.think;

import android.content.ContentProvider;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import android.webkit.MimeTypeMap;

import java.io.File;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

/**
 * Chỉ dùng trong app: phát lại các ảnh đã chép từ màn hình chọn ảnh cho khung chat của bong bóng nổi.
 * Tệp nằm trong bộ nhớ đệm của app, tự xóa sau một ngày.
 */
public class PickedFileProvider extends ContentProvider {
    static final String AUTHORITY = "com.nuwngc.think.picked";
    private static final long MAX_BYTES = 40L * 1024 * 1024;
    private static final long KEEP_MS = 24L * 60 * 60 * 1000;
    private static final String SEP = "__";

    static File dir(Context context) {
        return new File(context.getCacheDir(), "picked");
    }

    /** Chép các ảnh đã chọn vào bộ nhớ của app; trả về địa chỉ mới (content://com.nuwngc.think.picked/...). */
    static Uri[] copyAll(Context context, Uri[] sources) {
        File folder = dir(context);
        if (!folder.exists() && !folder.mkdirs()) return null;
        File[] old = folder.listFiles();
        long now = System.currentTimeMillis();
        if (old != null) for (File f : old) if (now - f.lastModified() > KEEP_MS) f.delete();
        ContentResolver cr = context.getContentResolver();
        List<Uri> out = new ArrayList<>();
        for (Uri src : sources) {
            String name = displayName(cr, src);
            String ext = extension(cr, src, name);
            String safe = name.replaceAll("[^A-Za-z0-9._-]", "_");
            if (safe.length() > 60) safe = safe.substring(safe.length() - 60);
            if (ext != null && !safe.toLowerCase(Locale.ROOT).endsWith("." + ext)) safe = safe + "." + ext;
            File dest = new File(folder, UUID.randomUUID().toString().substring(0, 8) + SEP + safe);
            try {
                InputStream in = cr.openInputStream(src);
                if (in == null) continue;
                OutputStream o = new FileOutputStream(dest);
                try {
                    byte[] buf = new byte[16384];
                    long total = 0;
                    int n;
                    while ((n = in.read(buf)) > 0) {
                        total += n;
                        if (total > MAX_BYTES) throw new java.io.IOException("Ảnh quá lớn");
                        o.write(buf, 0, n);
                    }
                } finally {
                    o.close();
                    in.close();
                }
                out.add(new Uri.Builder().scheme("content").authority(AUTHORITY).appendPath(dest.getName()).build());
            } catch (Exception e) {
                dest.delete();
            }
        }
        return out.isEmpty() ? null : out.toArray(new Uri[0]);
    }

    private static String displayName(ContentResolver cr, Uri uri) {
        Cursor c = null;
        try {
            c = cr.query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null);
            if (c != null && c.moveToFirst() && !c.isNull(0)) return c.getString(0);
        } catch (RuntimeException ignored) {
            // không đọc được tên
        } finally {
            if (c != null) c.close();
        }
        String last = uri.getLastPathSegment();
        return last == null ? "anh" : last;
    }

    private static String extension(ContentResolver cr, Uri uri, String name) {
        String type = cr.getType(uri);
        String ext = type == null ? null : MimeTypeMap.getSingleton().getExtensionFromMimeType(type);
        if (ext == null) {
            int dot = name.lastIndexOf('.');
            if (dot > 0) ext = name.substring(dot + 1).toLowerCase(Locale.ROOT);
        }
        return ext;
    }

    private File fileFor(Uri uri) {
        String name = uri.getLastPathSegment();
        if (name == null || name.contains("/") || name.contains("..") || getContext() == null) return null;
        File f = new File(dir(getContext()), name);
        return f.isFile() ? f : null;
    }

    private static String originalName(File f) {
        String n = f.getName();
        int i = n.indexOf(SEP);
        return i >= 0 ? n.substring(i + SEP.length()) : n;
    }

    @Override
    public boolean onCreate() {
        return true;
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection, String[] selectionArgs, String sortOrder) {
        File f = fileFor(uri);
        if (f == null) return null;
        String[] cols = projection != null ? projection : new String[] { OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE };
        MatrixCursor cursor = new MatrixCursor(cols, 1);
        Object[] row = new Object[cols.length];
        for (int i = 0; i < cols.length; i++) {
            if (OpenableColumns.DISPLAY_NAME.equals(cols[i])) row[i] = originalName(f);
            else if (OpenableColumns.SIZE.equals(cols[i])) row[i] = f.length();
        }
        cursor.addRow(row);
        return cursor;
    }

    @Override
    public String getType(Uri uri) {
        File f = fileFor(uri);
        String name = f == null ? uri.getLastPathSegment() : f.getName();
        if (name == null) return "application/octet-stream";
        int dot = name.lastIndexOf('.');
        String type = dot > 0 ? MimeTypeMap.getSingleton().getMimeTypeFromExtension(name.substring(dot + 1).toLowerCase(Locale.ROOT)) : null;
        return type == null ? "application/octet-stream" : type;
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        File f = fileFor(uri);
        if (f == null) throw new FileNotFoundException(uri.toString());
        return ParcelFileDescriptor.open(f, ParcelFileDescriptor.MODE_READ_ONLY);
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) {
        throw new UnsupportedOperationException("Chỉ đọc");
    }

    @Override
    public int delete(Uri uri, String selection, String[] selectionArgs) {
        return 0;
    }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) {
        return 0;
    }
}
