package org.viprpg.archive;

import static org.junit.Assert.*;

import android.content.ContextWrapper;
import android.util.AtomicFile;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import org.json.JSONObject;
import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = {29, 35}, manifest = Config.NONE)
public class LocalStorageTest {
    private static final String CONFIG = "/home/web_user/.config/easyrpg/config.ini";
    private static final String SAVE = "/work-saves/1/Save01.lsd";
    @Rule public TemporaryFolder temporary = new TemporaryFolder();
    private LocalStorage storage;
    private File shared;

    @Before public void setUp() throws Exception {
        File files = temporary.newFolder("files");
        storage = new LocalStorage(new ContextWrapper(RuntimeEnvironment.getApplication()) {
            @Override public File getFilesDir() { return files; }
        });
        shared = new File(storage.file(storage.root()), "player-config.json");
    }
    private JSONObject snapshot(String save, String config) throws Exception {
        return new JSONObject().put(SAVE, save).put(CONFIG, config);
    }
    private void putShared(String text) throws Exception {
        Files.write(shared.toPath(), text.getBytes(StandardCharsets.UTF_8));
    }

    @Test @Config(sdk = 35) public void failedFirstConfigWriteDoesNotFailCommittedSaveOrCreateEmptyBase() throws Exception {
        File pending = new File(shared + ".new");
        assertTrue(pending.mkdir());
        storage.save(1, snapshot("c2F2ZQ==", "Y29uZmln"));
        assertFalse(shared.exists());
        assertEquals("c2F2ZQ==", storage.loadSaves(1).getString(SAVE));
        assertEquals("Y29uZmln", storage.loadSaves(1).getString(CONFIG));
        assertEquals(0, storage.loadSaves(2).length());
        assertTrue(pending.delete());
        storage.save(1, snapshot("bmV3", "bmV3Y29uZmln"));
        assertEquals("bmV3Y29uZmln", storage.loadSaves(2).getString(CONFIG));
    }

    @Test public void invalidSharedConfigFallsBackWithoutLosingGameData() throws Exception {
        storage.save(1, snapshot("c2F2ZQ==", "Y29uZmln"));
        String[] invalid = {"", "{", "[]", "{\"" + CONFIG + "\":42}",
            "{\"" + CONFIG + "\":\"a\"}",
            "{\"" + CONFIG + "\":\"bmV3\",\"/work-saves/2/Save01.lsd\":\"YQ==\"}",
            "{\"/home/web_user/.config/../escape\":\"YQ==\"}"};
        for (String text : invalid) {
            putShared(text);
            JSONObject loaded = storage.loadSaves(1);
            assertEquals(text, "c2F2ZQ==", loaded.getString(SAVE));
            assertEquals(text, "Y29uZmln", loaded.getString(CONFIG));
            assertEquals(text, 0, storage.loadSaves(2).length());
            assertEquals(text, Files.readString(shared.toPath()));
        }
        storage.save(1, snapshot("bmV3", "bmV3Y29uZmln"));
        assertEquals("bmV3", storage.loadSaves(1).getString(SAVE));
        assertEquals("bmV3Y29uZmln", storage.loadSaves(2).getString(CONFIG));
    }

    @Test public void validSharedSettingsReplaceOnlyConfigAndEmptyObjectClearsIt() throws Exception {
        storage.save(1, snapshot("c2F2ZQ==", "b2xk"));
        putShared(new JSONObject().put(CONFIG, "bmV3").toString());
        assertEquals("bmV3", storage.loadSaves(1).getString(CONFIG));
        assertEquals("c2F2ZQ==", storage.loadSaves(1).getString(SAVE));
        putShared("{}");
        assertFalse(storage.loadSaves(1).has(CONFIG));
        assertEquals("c2F2ZQ==", storage.loadSaves(1).getString(SAVE));
    }

    @Test public void backupOnlyAndInterruptedReplacementRecoverAtomicConfig() throws Exception {
        File backup = new File(shared + ".bak");
        String config = new JSONObject().put(CONFIG, "Y29uZmln").toString();
        Files.writeString(backup.toPath(), config);
        assertEquals("Y29uZmln", storage.loadSaves(2).getString(CONFIG));
        assertTrue(shared.isFile());
        assertFalse(backup.exists());
        Files.writeString(backup.toPath(), config);
        putShared("{");
        assertEquals("Y29uZmln", storage.loadSaves(2).getString(CONFIG));
        assertEquals(config, Files.readString(shared.toPath()));
    }

    @Test @Config(sdk = 35) public void failedReplacementPreservesGoodSharedConfigAndBothSaveGenerations() throws Exception {
        storage.save(1, snapshot("b2xk", "b2xkY29uZmln"));
        byte[] oldConfig = Files.readAllBytes(shared.toPath());
        File pending = new File(shared + ".new");
        assertTrue(pending.mkdir());
        // openRead removes stale .new files; keep this obstruction nonempty so
        // it survives the preceding read and actually faults startWrite.
        Files.writeString(new File(pending, "blocked").toPath(), "blocked");
        storage.save(1, snapshot("bmV3", "bmV3Y29uZmln"));
        assertArrayEquals(oldConfig, Files.readAllBytes(shared.toPath()));
        assertEquals("bmV3", storage.loadSaves(1).getString(SAVE));
        assertEquals("bmV3Y29uZmln", storage.loadGeneration(1).getJSONObject("files").getString(CONFIG));
        File generations = new File(storage.file(storage.root()), "saves/1");
        assertEquals(2, generations.listFiles((dir, name) -> name.endsWith(".json")).length);
    }

    @Test public void atomicFailWriteRollsBackPartialConfigBytes() throws Exception {
        storage.save(1, snapshot("c2F2ZQ==", "Y29uZmln"));
        AtomicFile atomic = new AtomicFile(shared);
        FileOutputStream out = atomic.startWrite();
        out.write('{');
        atomic.failWrite(out);
        assertEquals("Y29uZmln", storage.loadSaves(2).getString(CONFIG));
    }

    @Test public void corruptGameGenerationsStillFailInsteadOfSilentlyResettingSaves() throws Exception {
        storage.save(1, snapshot("c2F2ZQ==", "Y29uZmln"));
        File folder = new File(storage.file(storage.root()), "saves/1");
        for (File generation : folder.listFiles()) Files.writeString(generation.toPath(), "broken");
        putShared("");
        assertThrows(java.io.IOException.class, () -> storage.loadSaves(1));
    }
}
