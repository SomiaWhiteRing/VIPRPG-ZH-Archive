package org.viprpg.archive;

import java.io.IOException;
import java.net.HttpURLConnection;
import java.nio.charset.StandardCharsets;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Byte accounting for the installer, independent of Android storage and network APIs. */
final class GameInstallSize {
    private static final Pattern RANGE = Pattern.compile("bytes ([0-9]+)-([0-9]+)/([0-9]+)");
    static final int MAX_FILES = 50000;
    static final long ZIP32_ENTRY_LIMIT = 0xffffffffL;
    static final long ZIP_END_BYTES = 22;
    // A date in the middle of the DOS timestamp range, with no extended-time field.
    static final long ZIP_TIME = 946684800000L;
    private static final long MIB = 1024L * 1024;

    static long downloadSize(HttpURLConnection response, int code, long offset, long contentBytes) throws IOException {
        return downloadSize(code, offset, response.getContentLengthLong(), response.getHeaderField("Content-Range"), contentBytes);
    }

    static long downloadSize(int code, long offset, long length, String range, long contentBytes) throws IOException {
        long total = length;
        if (code == 206) {
            Matcher match = RANGE.matcher(range == null ? "" : range);
            try {
                if (!match.matches()) throw new NumberFormatException();
                long start = Long.parseLong(match.group(1)), end = Long.parseLong(match.group(2));
                total = Long.parseLong(match.group(3));
                if (start != offset || start >= total || end != total - 1 || (length >= 0 && length != total - start))
                    throw new NumberFormatException();
            } catch (NumberFormatException invalid) {
                throw new IOException("服务器返回的下载续传范围无效，请重试。");
            }
        }
        if (total <= 0) throw new IOException("服务器未提供有效的安装包大小，无法确认磁盘空间。");
        if (total < contentBytes) throw new IOException("服务器返回的安装包大小小于版本声明的文件大小。");
        return total;
    }

    // STORE entries written with ZIP_TIME have no extra fields or data descriptors.
    static long storedEntryBytes(String path, long bytes) throws IOException {
        int nameBytes = path.getBytes(StandardCharsets.UTF_8).length;
        if (nameBytes > 0xffff || bytes < 0 || bytes >= ZIP32_ENTRY_LIMIT)
            throw new IOException("游戏文件超过 ZIP 格式支持的文件名长度或单文件大小。");
        return 76L + 2L * nameBytes + bytes;
    }

    static long stagingBytes(long zipBytes, long stagedBytes, boolean sharedVolume) throws IOException {
        if (zipBytes <= 0 || stagedBytes < 0 || stagedBytes > zipBytes)
            throw new IOException("安装包字节数无效，请重试。");
        long remaining = zipBytes - stagedBytes;
        try {
            return sharedVolume ? Math.addExact(remaining, zipBytes) : remaining;
        } catch (ArithmeticException invalid) {
            throw new IOException("服务器返回的安装包大小无效。", invalid);
        }
    }

    static void requireSpace(String purpose, long required, long available) throws IOException {
        if (available < required) {
            long missing = required - available;
            throw new IOException(purpose + "空间不足：需要 " + roundUpMiB(required) + " MiB，当前可用 "
                + available / MIB + " MiB。请至少再腾出 " + roundUpMiB(missing) + " MiB 后重试。");
        }
    }

    private static long roundUpMiB(long bytes) { return bytes / MIB + (bytes % MIB == 0 ? 0 : 1); }
}
