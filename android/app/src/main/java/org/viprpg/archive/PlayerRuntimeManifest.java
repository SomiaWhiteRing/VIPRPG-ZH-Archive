package org.viprpg.archive;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

record PlayerRuntimeManifest(String id, String version, Map<String, Asset> files) {
    static final int CHUNK_SIZE = 1024 * 1024;
    static final int MAX_FILE_SIZE = 32 * CHUNK_SIZE;
    static final int MAX_MANIFEST_SIZE = 256 * 1024;
    private static final Pattern DIGEST = Pattern.compile("[0-9a-f]{64}");
    private static final Pattern NAME = Pattern.compile("[A-Za-z0-9][A-Za-z0-9._-]{0,119}");
    private static final Set<String> REQUIRED = new HashSet<>(Arrays.asList(
        "index.js", "native-storage.js", "player-worker.js", "player-audio.js", "player-audio-worker.js",
        "player-files.js", "easyrpg-player.js", "easyrpg-player.wasm", "easyrpg-player.data",
        "easyrpg-player-asyncify.js", "easyrpg-player-asyncify.wasm",
        "player-movie.js", "player-movie-worker.js", "movie-decoder.js", "movie-decoder.wasm", "COPYING", "SOURCE.json"));

    record Part(String sha256, int size) {}
    record Patch(String base, List<Part> parts) {}
    record Asset(String name, String sha256, int size, List<Part> parts, Patch patch) {}

    static PlayerRuntimeManifest parse(JSONObject json) throws JSONException {
        if (json.getInt("schema") != 1) throw new JSONException("Unsupported Android Player manifest");
        String id = digest(json, "id");
        String version = json.getString("version");
        if (!NAME.matcher(version).matches()) throw new JSONException("Invalid Android Player version");
        JSONArray entries = json.getJSONArray("files");
        if (entries.length() > 80) throw new JSONException("Too many Android Player files");
        Map<String, Asset> files = new LinkedHashMap<>();
        long total = 0;
        for (int index = 0; index < entries.length(); index++) {
            JSONObject entry = entries.getJSONObject(index);
            String name = entry.getString("name");
            int size = entry.getInt("size");
            if (!NAME.matcher(name).matches() || files.containsKey(name) || size < 1 || size > MAX_FILE_SIZE)
                throw new JSONException("Invalid Android Player file");
            JSONObject patchJson = entry.optJSONObject("patch");
            Patch patch = patchJson == null ? null : new Patch(digest(patchJson, "base"), parts(patchJson));
            files.put(name, new Asset(name, digest(entry, "sha256"), size, parts(entry), patch));
            total += size;
        }
        if (total > 96L * CHUNK_SIZE || !files.keySet().containsAll(REQUIRED))
            throw new JSONException("Incomplete or oversized Android Player");
        return new PlayerRuntimeManifest(id, version, Collections.unmodifiableMap(files));
    }

    private static List<Part> parts(JSONObject entry) throws JSONException {
        JSONArray values = entry.getJSONArray("parts");
        if (values.length() < 1 || values.length() > 33) throw new JSONException("Invalid Android Player part count");
        List<Part> parts = new ArrayList<>();
        for (int index = 0; index < values.length(); index++) {
            JSONObject part = values.getJSONObject(index);
            int size = part.getInt("size");
            if (size < 1 || size > CHUNK_SIZE) throw new JSONException("Invalid Android Player part size");
            parts.add(new Part(digest(part, "sha256"), size));
        }
        return Collections.unmodifiableList(parts);
    }

    private static String digest(JSONObject json, String field) throws JSONException {
        String value = json.getString(field);
        if (!DIGEST.matcher(value).matches()) throw new JSONException("Invalid Android Player digest");
        return value;
    }
}
