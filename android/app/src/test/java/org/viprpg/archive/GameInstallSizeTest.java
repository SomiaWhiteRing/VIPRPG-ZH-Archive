package org.viprpg.archive;

import static org.junit.Assert.*;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.zip.CRC32;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import org.junit.Test;

public class GameInstallSizeTest {
    private static final long SDW_BYTES = 1130960068L;
    private static final long SDW_ZIP = 1134611638L;

    @Test public void largeArchiveUsesDeviceSpaceRatherThanFixedSizeLimit() throws IOException {
        long required = GameInstallSize.stagingBytes(SDW_ZIP, 0, true);
        assertEquals(SDW_ZIP * 2, required);
        GameInstallSize.requireSpace("下载和安装", required, 3L * 1024 * 1024 * 1024);
        IOException error = assertThrows(IOException.class, () ->
            GameInstallSize.requireSpace("下载和安装", required, 2L * 1024 * 1024 * 1024));
        assertTrue(error.getMessage().contains("需要 2165 MiB，当前可用 2048 MiB"));
        assertTrue(error.getMessage().contains("再腾出 117 MiB"));
        long aboveOldDownloadCap = 1300L * 1024 * 1024;
        GameInstallSize.requireSpace("下载和安装",
            GameInstallSize.stagingBytes(aboveOldDownloadCap, 0, true), aboveOldDownloadCap * 2);
    }

    @Test public void resumeCountsOnlyMissingTemporaryBytes() throws IOException {
        long staged = 536870912;
        assertEquals(SDW_ZIP * 2 - staged, GameInstallSize.stagingBytes(SDW_ZIP, staged, true));
        assertEquals(SDW_ZIP - staged, GameInstallSize.stagingBytes(SDW_ZIP, staged, false));
        assertEquals(SDW_ZIP, GameInstallSize.stagingBytes(SDW_ZIP, SDW_ZIP, true));
        assertThrows(IOException.class, () -> GameInstallSize.stagingBytes(Long.MAX_VALUE, 0, true));
    }

    @Test public void validatesFullAndResumedHttpLengths() throws IOException {
        assertEquals(SDW_ZIP, GameInstallSize.downloadSize(200, 0, SDW_ZIP, null, SDW_BYTES));
        String range = "bytes 100-1134611637/1134611638";
        assertEquals(SDW_ZIP, GameInstallSize.downloadSize(206, 100, SDW_ZIP - 100, range, SDW_BYTES));
        assertEquals(SDW_ZIP, GameInstallSize.downloadSize(206, 100, -1, range, SDW_BYTES));
        assertThrows(IOException.class, () -> GameInstallSize.downloadSize(206, 101, SDW_ZIP - 100, range, SDW_BYTES));
        assertThrows(IOException.class, () -> GameInstallSize.downloadSize(206, 100, SDW_ZIP, range, SDW_BYTES));
        assertThrows(IOException.class, () -> GameInstallSize.downloadSize(206, 100, SDW_ZIP - 100,
            "bytes 100-1134611636/1134611638", SDW_BYTES));
        assertThrows(IOException.class, () -> GameInstallSize.downloadSize(200, 0, -1, null, SDW_BYTES));
        assertThrows(IOException.class, () -> GameInstallSize.downloadSize(200, 0, SDW_BYTES - 1, null, SDW_BYTES));
    }

    @Test public void completedDownloadIsReusableOnlyAtConfirmedEndOfRange() {
        String end = "bytes */1134611638";
        assertTrue(GameInstallSize.completeOnRangeEnd(SDW_ZIP, end, SDW_BYTES));
        assertFalse(GameInstallSize.completeOnRangeEnd(SDW_ZIP + 1, end, SDW_BYTES));
        assertFalse(GameInstallSize.completeOnRangeEnd(SDW_ZIP - 1, end, SDW_BYTES));
        assertFalse(GameInstallSize.completeOnRangeEnd(SDW_ZIP, null, SDW_BYTES));
        assertFalse(GameInstallSize.completeOnRangeEnd(SDW_BYTES - 1, "bytes */1130960067", SDW_BYTES));
    }

    @Test public void deltaSizeMatchesStoredZipIncludingMultibyteNames() throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        long expected = GameInstallSize.ZIP_END_BYTES;
        try (ZipOutputStream zip = new ZipOutputStream(out, StandardCharsets.UTF_8)) {
            for (String path : new String[]{"RPG_RT.ldb", "Picture/中文.png", "空文件"}) {
                byte[] data = path.equals("空文件") ? new byte[0] : new byte[]{1, 2, 3, 4};
                CRC32 crc = new CRC32();
                crc.update(data);
                ZipEntry entry = new ZipEntry(path);
                entry.setMethod(ZipEntry.STORED);
                entry.setTime(GameInstallSize.ZIP_TIME);
                entry.setSize(data.length);
                entry.setCompressedSize(data.length);
                entry.setCrc(crc.getValue());
                zip.putNextEntry(entry);
                zip.write(data);
                zip.closeEntry();
                expected += GameInstallSize.storedEntryBytes(path, data.length);
            }
        }
        assertEquals(expected, out.size());
    }
}
