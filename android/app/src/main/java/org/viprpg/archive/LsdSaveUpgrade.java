package org.viprpg.archive;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/** Losslessly replace the old Player numeric-vector copy with its logical length. */
final class LsdSaveUpgrade {
    private static final byte[] HEADER = "\u000bLcfSaveData".getBytes(StandardCharsets.US_ASCII);
    static final int COMPACT_SAVE_VERSION = 813;

    private static final class Field {
        final int id, start, data, end;
        Field(int id, int start, int data, int end) { this.id = id; this.start = start; this.data = data; this.end = end; }
    }
    private static final class Cursor {
        final byte[] bytes;
        final int end;
        int position;
        Cursor(byte[] bytes, int start, int end) { this.bytes = bytes; position = start; this.end = end; }
        int number() throws IOException {
            long value = 0;
            for (int count = 0; count < 5 && position < end; count++) {
                int next = bytes[position++] & 255;
                value = (value << 7) | (next & 127);
                if (value > Integer.MAX_VALUE) break;
                if ((next & 128) == 0) return (int)value;
            }
            throw new IOException("存档字段长度无效。");
        }
        List<Field> fields() throws IOException {
            List<Field> fields = new ArrayList<>();
            while (position < end) {
                int start = position, id = number();
                if (id == 0) {
                    if (position != end) throw new IOException("存档字段末尾无效。");
                    break;
                }
                int length = number(), data = position;
                if (length > end - data) throw new IOException("存档字段不完整。");
                position += length;
                fields.add(new Field(id, start, data, position));
            }
            return fields;
        }
    }
    private static Field find(List<Field> fields, int id) throws IOException {
        Field found = null;
        for (Field field : fields) if (field.id == id) {
            if (found != null) throw new IOException("存档升级字段重复。");
            found = field;
        }
        return found;
    }
    private static int number(byte[] bytes, Field field) throws IOException {
        Cursor cursor = new Cursor(bytes, field.data, field.end);
        int value = cursor.number();
        if (cursor.position != field.end) throw new IOException("存档数值字段无效。");
        return value;
    }
    private static void number(ByteArrayOutputStream out, int value) {
        int shift = 28;
        while (shift > 0 && (value >>> shift) == 0) shift -= 7;
        for (; shift >= 0; shift -= 7) out.write(((value >>> shift) & 127) | (shift > 0 ? 128 : 0));
    }
    private static void field(ByteArrayOutputStream out, int id, byte[] value) {
        number(out, id); number(out, value.length); out.write(value, 0, value.length);
    }
    private static byte[] encoded(int value) {
        ByteArrayOutputStream out = new ByteArrayOutputStream(5); number(out, value); return out.toByteArray();
    }

    static byte[] compact(byte[] bytes) throws IOException {
        if (bytes.length < HEADER.length || !Arrays.equals(HEADER, Arrays.copyOf(bytes, HEADER.length))) return bytes;
        List<Field> root = new Cursor(bytes, HEADER.length, bytes.length).fields();
        Field extra = find(root, 0xc8), system = find(root, 0x65);
        if (extra == null) return bytes;
        List<Field> fields = new Cursor(bytes, extra.data, extra.end).fields();
        Field version = find(fields, 1), full = find(fields, 0x6f);
        if (version == null || full == null || find(fields, 0x71) != null) return bytes;
        int oldVersion = number(bytes, version);
        if (oldVersion <= 0 || oldVersion >= COMPACT_SAVE_VERSION) return bytes;
        int length = full.end - full.data;
        if (length % 4 != 0 || system == null) throw new IOException("旧变量表无效。");
        Field values = find(new Cursor(bytes, system.data, system.end).fields(), 0x22);
        int prefix = values == null ? 0 : values.end - values.data;
        if (prefix % 4 != 0 || prefix > length) throw new IOException("旧变量表长度矛盾。");
        for (int i = 0; i < length; i++) {
            int expected = i < prefix ? bytes[values.data + i] : 0;
            if (bytes[full.data + i] != expected) throw new IOException("旧变量表内容矛盾。");
        }

        ByteArrayOutputStream payload = new ByteArrayOutputStream(extra.end - extra.data - length + 16);
        for (Field current : fields) {
            if (current == full) continue;
            if (current == version) field(payload, 1, encoded(COMPACT_SAVE_VERSION));
            else payload.write(bytes, current.start, current.end - current.start);
        }
        field(payload, 0x71, encoded(length / 4));
        // Keep the original optional struct terminator.
        if (extra.end > extra.data && bytes[extra.end - 1] == 0
                && (fields.isEmpty() || fields.get(fields.size() - 1).end < extra.end)) payload.write(0);
        ByteArrayOutputStream result = new ByteArrayOutputStream(bytes.length - length + 16);
        result.write(bytes, 0, extra.start);
        field(result, 0xc8, payload.toByteArray());
        result.write(bytes, extra.end, bytes.length - extra.end);
        return result.toByteArray();
    }
}
