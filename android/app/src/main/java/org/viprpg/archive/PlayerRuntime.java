package org.viprpg.archive;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.AtomicFile;
import android.util.Log;
import android.webkit.WebResourceResponse;
import android.webkit.MimeTypeMap;

import com.github.luben.zstd.ZstdInputStreamNoFinalizer;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.*;
import java.net.HttpURLConnection;
import java.net.SocketException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.security.DigestOutputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Objects;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.Consumer;
import java.util.zip.GZIPInputStream;
import java.util.zip.ZipException;

import org.viprpg.archive.PlayerRuntimeManifest.Asset;
import org.viprpg.archive.PlayerRuntimeManifest.Part;
import org.viprpg.archive.PlayerRuntimeManifest.Patch;

final class PlayerRuntime {
    static final String LOCAL_PATH = "/_native/player/";
    private static final String REMOTE_PATH = "/play/runtime/android/v1/";
    private static final String TAG = "PlayerRuntime";
    enum Phase { HIDDEN, DOWNLOADING, MOBILE, PAUSED, OFFLINE, FAILED, VERIFYING }
    record State(Phase phase, boolean ready, long downloaded, long total, long speed) {}
    record Installation(PlayerRuntimeManifest manifest, File directory) {
        String basePath() { return LOCAL_PATH + manifest.id(); }
    }
    private record Offer(PlayerRuntimeManifest manifest, byte[] json) {}
    private record Link(Network network, boolean automatic) {}
    private static final class Paused extends IOException {}
    private static final class InvalidPart extends IOException {
        InvalidPart(String message) { super(message); }
    }

    private static PlayerRuntime instance;
    static synchronized PlayerRuntime get(Context context) {
        if (instance == null) instance = new PlayerRuntime(context.getApplicationContext());
        return instance;
    }

    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final ConnectivityManager connectivity;
    private final SharedPreferences preferences;
    private final File versions;
    private final File downloads;
    private final AtomicFile installedFile;
    private volatile Installation active;
    private volatile Link link;
    private volatile boolean paused;
    private volatile boolean allowMobile;
    private Offer offer;
    private boolean busy;
    private State state;
    private Consumer<State> listener;

    private PlayerRuntime(Context context) {
        File root = new File(context.getFilesDir(), "player");
        versions = new File(root, "versions");
        downloads = new File(root, "downloads");
        installedFile = new AtomicFile(new File(root, "installed.json"));
        preferences = context.getSharedPreferences("player-runtime", Context.MODE_PRIVATE);
        try (InputStream input = installedFile.openRead()) {
            PlayerRuntimeManifest manifest = parse(GameStore.readStream(input, PlayerRuntimeManifest.MAX_MANIFEST_SIZE));
            File directory = new File(versions, manifest.id());
            if (manifest.files().values().stream().allMatch(asset -> {
                File file = new File(directory, asset.name());
                return file.isFile() && file.length() == asset.size();
            })) active = new Installation(manifest, directory);
        } catch (FileNotFoundException ignored) {
            // The first launch has no installed Player.
        } catch (IOException | JSONException error) {
            Log.w(TAG, "Could not read installed Player", error);
        }
        state = new State(Phase.HIDDEN, active != null, 0, 0, 0);
        connectivity = context.getSystemService(ConnectivityManager.class);
        connectivity.registerDefaultNetworkCallback(new ConnectivityManager.NetworkCallback() {
            @Override public void onCapabilitiesChanged(Network network, NetworkCapabilities capabilities) {
                main.post(PlayerRuntime.this::networkChanged);
            }
            @Override public void onLost(Network network) { main.post(PlayerRuntime.this::networkChanged); }
        });
        link = currentLink();
    }

    void observe(Consumer<State> next) {
        listener = next;
        next.accept(state);
    }

    void removeObserver(Consumer<State> previous) {
        if (listener == previous) listener = null;
    }

    Installation installed() { return active; }
    boolean ready() { return active != null; }

    void check() {
        if (busy) return;
        link = currentLink();
        if (link == null) {
            if (offer != null || !ready()) publish(waiting(), state.downloaded(), state.total(), 0);
            return;
        }
        Link source = link;
        busy = true;
        io.execute(() -> {
            try {
                HttpURLConnection connection = open(source, "latest.json");
                byte[] json;
                try {
                    if (connection.getResponseCode() != 200) throw new IOException("Android Player manifest unavailable");
                    try (InputStream input = connection.getInputStream()) {
                        json = GameStore.readStream(input, PlayerRuntimeManifest.MAX_MANIFEST_SIZE);
                    }
                } finally {
                    connection.disconnect();
                }
                Offer next = new Offer(parse(json), json);
                main.post(() -> accept(next));
            } catch (IOException | JSONException error) {
                Log.w(TAG, "Could not check Player", error);
                main.post(() -> {
                    busy = false;
                    if (offer != null) proceed();
                    else if (!ready())
                        publish(link == null ? Phase.OFFLINE : Phase.FAILED, 0, 0, 0);
                });
            }
        });
    }

    void toggle() {
        if (state.phase() == Phase.DOWNLOADING && offer != null) {
            paused = true;
            preferences.edit().putString("paused", offer.manifest().id()).apply();
            publish(Phase.PAUSED, state.downloaded(), state.total(), 0);
        } else if (offer == null) {
            check();
        } else {
            paused = false;
            allowMobile = link != null && !link.automatic();
            preferences.edit().remove("paused").apply();
            if (state.phase() == Phase.FAILED) check();
            else proceed();
        }
    }

    private Link currentLink() {
        Network network = connectivity.getActiveNetwork();
        NetworkCapabilities capabilities = connectivity.getNetworkCapabilities(network);
        if (capabilities == null || !capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)) return null;
        boolean automatic = !capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)
            && capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED);
        return new Link(network, automatic);
    }

    private void networkChanged() {
        Link previous = link;
        link = currentLink();
        if (Objects.equals(previous, link)) return;
        if (link == null || link.automatic() || previous == null || !previous.network().equals(link.network())) allowMobile = false;
        if (offer != null) {
            if (state.phase() != Phase.FAILED || link == null) proceed();
        } else if (!ready() && link != null) check();
        else if (!ready()) publish(Phase.OFFLINE, 0, 0, 0);
    }

    private void accept(Offer next) {
        busy = false;
        if (active != null && active.manifest().id().equals(next.manifest().id())) {
            offer = null;
            publish(Phase.HIDDEN, 0, 0, 0);
            return;
        }
        if (offer == null || !offer.manifest().id().equals(next.manifest().id())) {
            paused = next.manifest().id().equals(preferences.getString("paused", ""));
            allowMobile = false;
            state = new State(state.phase(), ready(), 0, 0, 0);
        }
        offer = next;
        Transfer transfer = new Transfer(next, active);
        transfer.count();
        state = new State(state.phase(), ready(), transfer.done, transfer.total, 0);
        proceed();
    }

    private Phase waiting() {
        if (paused) return Phase.PAUSED;
        Link available = link;
        if (available == null) return Phase.OFFLINE;
        if (!available.automatic() && !allowMobile) return Phase.MOBILE;
        return Phase.DOWNLOADING;
    }

    private void proceed() {
        Phase phase = waiting();
        if (state.phase() != Phase.VERIFYING || !busy)
            publish(phase, state.downloaded(), state.total(), 0);
        if (busy || offer == null || phase != Phase.DOWNLOADING) return;
        busy = true;
        Transfer transfer = new Transfer(offer, active);
        io.execute(() -> {
            try {
                Installation installed = transfer.install();
                main.post(() -> {
                    active = installed;
                    offer = null;
                    busy = false;
                    publish(Phase.HIDDEN, 0, 0, 0);
                });
            } catch (IOException error) {
                // The socket can abort before Android updates the default network.
                main.postDelayed(() -> {
                    Link previous = link;
                    networkChanged();
                    busy = false;
                    if (error instanceof Paused || !Objects.equals(previous, link) || waiting() != Phase.DOWNLOADING) proceed();
                    else {
                        Log.w(TAG, "Could not install Player", error);
                        publish(Phase.FAILED, state.downloaded(), state.total(), 0);
                    }
                }, error instanceof SocketException ? 1_000 : 0);
            }
        });
    }

    private void publish(Phase phase, long done, long total, long speed) {
        State next = new State(phase, ready(), done, total, speed);
        if (next.equals(state)) return;
        state = next;
        if (listener != null) listener.accept(next);
    }

    static WebResourceResponse read(Installation installed, String path) {
        String prefix = installed == null ? null : installed.basePath() + "/";
        if (prefix != null && path.startsWith(prefix)) {
            String name = path.substring(prefix.length());
            if (installed.manifest().files().containsKey(name)) {
                String extension = name.substring(name.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT);
                String type = switch (extension) {
                    case "js" -> "application/javascript";
                    case "wasm" -> "application/wasm";
                    default -> MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension);
                };
                try {
                    return new WebResourceResponse(type == null ? "application/octet-stream" : type, null,
                        new FileInputStream(new File(installed.directory(), name)));
                } catch (FileNotFoundException error) {
                    Log.w(TAG, "Installed Player file missing", error);
                }
            }
        }
        return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found",
            java.util.Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
    }

    private final class Transfer {
        private final Offer target;
        private final Installation base;
        private final File output;
        private final File parts;
        private long total;
        private long done;
        private long lastBytes;
        private long lastTime;

        Transfer(Offer target, Installation base) {
            this.target = target;
            this.base = base;
            output = new File(versions, target.manifest().id());
            parts = new File(downloads, target.manifest().id());
        }

        private Asset old(Asset file) {
            return base == null ? null : base.manifest().files().get(file.name());
        }

        private File fullMarker(Asset file) { return new File(parts, file.name() + ".full"); }
        private File chunk(Part part) { return new File(parts, part.sha256() + ".bin"); }

        private Patch patch(Asset file, Asset old) {
            Patch patch = file.patch();
            if (patch == null || old == null || !patch.base().equals(old.sha256()) || fullMarker(file).isFile()) return null;
            return patch;
        }

        void count() {
            done = 0;
            total = 0;
            Set<String> counted = new HashSet<>();
            for (Asset file : target.manifest().files().values()) {
                Asset old = old(file);
                if (old != null && old.sha256().equals(file.sha256()) && !fullMarker(file).isFile()) continue;
                Patch patch = patch(file, old);
                for (Part part : patch == null ? file.parts() : patch.parts()) {
                    if (!counted.add(part.sha256())) continue;
                    total += part.size();
                    if (chunk(part).length() == part.size()) done += part.size();
                }
            }
        }

        Installation install() throws IOException {
            Files.createDirectories(output.toPath());
            Files.createDirectories(parts.toPath());
            removeOtherDirectories(downloads, parts, null);
            removeOtherDirectories(versions, output, base == null ? null : base.directory());
            count();
            lastBytes = done;
            lastTime = SystemClock.elapsedRealtime();
            progress(Phase.DOWNLOADING, 0);
            // A game session may still be reading the active directory while this version is prepared.
            for (Asset file : target.manifest().files().values()) {
                requireLink();
                File destination = new File(output, file.name());
                if (valid(destination, file)) continue;
                Asset old = old(file);
                File reference = old == null ? null : new File(base.directory(), file.name());
                if (old != null && old.sha256().equals(file.sha256())) {
                    if (valid(reference, file)) {
                        Files.copy(reference.toPath(), destination.toPath(), StandardCopyOption.REPLACE_EXISTING);
                        continue;
                    }
                    useFullFile(file);
                }
                Patch patch = patch(file, old);
                if (patch != null) {
                    try {
                        assemble(file, patch.parts(), reference, destination);
                        continue;
                    } catch (InvalidPart | LinkageError error) {
                        Log.w(TAG, "Player patch failed for " + file.name() + ", downloading full file", error);
                        useFullFile(file);
                    }
                }
                try {
                    assemble(file, file.parts(), null, destination);
                } catch (InvalidPart error) {
                    for (Part part : file.parts()) Files.deleteIfExists(chunk(part).toPath());
                    count();
                    progress(Phase.DOWNLOADING, 0);
                    throw error;
                }
            }
            progress(Phase.VERIFYING, 0);
            FileOutputStream out = installedFile.startWrite();
            try {
                out.write(target.json());
                installedFile.finishWrite(out);
            } catch (IOException error) {
                installedFile.failWrite(out);
                throw error;
            }
            try {
                removeOtherDirectories(downloads, null, null);
            } catch (IOException error) {
                Log.w(TAG, "Could not remove completed Player download", error);
            }
            return new Installation(target.manifest(), output);
        }

        private void useFullFile(Asset file) throws IOException {
            Files.write(fullMarker(file).toPath(), new byte[0]);
            count();
            lastBytes = done;
            lastTime = SystemClock.elapsedRealtime();
            progress(Phase.DOWNLOADING, 0);
        }

        private void assemble(Asset file, List<Part> entries, File reference, File destination) throws IOException {
            File compressed = new File(parts, "transfer.tmp");
            try (OutputStream out = new BufferedOutputStream(new FileOutputStream(compressed))) {
                for (Part part : entries) {
                    requireLink();
                    File cached = chunk(part);
                    if (cached.length() != part.size()) download(part, cached);
                    Files.copy(cached.toPath(), out);
                }
            }
            File prepared = new File(parts, "file.tmp");
            MessageDigest hash = sha256();
            if (done == total) progress(Phase.VERIFYING, 0);
            try (InputStream wire = new BufferedInputStream(new FileInputStream(compressed));
                 InputStream decoded = reference == null ? new GZIPInputStream(wire)
                     : new ZstdInputStreamNoFinalizer(wire);
                 OutputStream out = new DigestOutputStream(new BufferedOutputStream(new FileOutputStream(prepared)), hash)) {
                if (decoded instanceof ZstdInputStreamNoFinalizer zstd)
                    zstd.setLongMax(26).setDict(Files.readAllBytes(reference.toPath()));
                byte[] buffer = new byte[64 * 1024];
                int length;
                int bytes = 0;
                while ((length = decoded.read(buffer)) != -1) {
                    bytes += length;
                    if (bytes > file.size()) throw new InvalidPart("Android Player file exceeds its size");
                    out.write(buffer, 0, length);
                }
                if (bytes != file.size() || !hex(hash.digest()).equals(file.sha256()))
                    throw new InvalidPart("Android Player file checksum mismatch");
            } catch (IOException error) {
                if (error instanceof InvalidPart || (reference == null && !(error instanceof ZipException) && !(error instanceof EOFException)))
                    throw error;
                throw new InvalidPart(error.toString());
            }
            Files.move(prepared.toPath(), destination.toPath(), StandardCopyOption.REPLACE_EXISTING);
        }

        private void download(Part part, File cached) throws IOException {
            Link source = requireLink();
            HttpURLConnection connection = open(source, "parts/" + part.sha256() + ".bin");
            File temporary = new File(parts, "chunk.tmp");
            long before = done;
            try {
                int status = connection.getResponseCode();
                if (status == 404 || status == 410) throw new InvalidPart("Android Player part unavailable");
                if (status != 200) throw new IOException("Android Player download returned " + status);
                MessageDigest hash = sha256();
                try (InputStream input = connection.getInputStream();
                     OutputStream out = new DigestOutputStream(new FileOutputStream(temporary), hash)) {
                    byte[] buffer = new byte[64 * 1024];
                    int length;
                    while ((length = input.read(buffer)) != -1) {
                        if (!source.equals(requireLink())) throw new Paused();
                        done += length;
                        if (done - before > part.size()) throw new InvalidPart("Android Player part is oversized");
                        out.write(buffer, 0, length);
                        long now = SystemClock.elapsedRealtime();
                        if (now - lastTime >= 400) {
                            progress(Phase.DOWNLOADING, Math.max(0, (done - lastBytes) * 1000 / (now - lastTime)));
                            lastBytes = done;
                            lastTime = now;
                        }
                    }
                }
                if (done - before != part.size() || !hex(hash.digest()).equals(part.sha256()))
                    throw new InvalidPart("Android Player part checksum mismatch");
                Files.move(temporary.toPath(), cached.toPath(), StandardCopyOption.REPLACE_EXISTING);
            } catch (IOException error) {
                done = before;
                progress(Phase.DOWNLOADING, 0);
                throw error;
            } finally {
                connection.disconnect();
            }
        }

        private void progress(Phase phase, long speed) {
            long downloaded = done, size = total;
            main.post(() -> {
                Phase wait = waiting();
                publish(wait == Phase.DOWNLOADING ? phase : wait, downloaded, size, wait == Phase.DOWNLOADING ? speed : 0);
            });
        }
    }

    private Link requireLink() throws Paused {
        Link available = link;
        if (paused || available == null || (!available.automatic() && !allowMobile)) throw new Paused();
        return available;
    }

    private static PlayerRuntimeManifest parse(byte[] bytes) throws JSONException {
        return PlayerRuntimeManifest.parse(new JSONObject(new String(bytes, StandardCharsets.UTF_8)));
    }

    private static HttpURLConnection open(Link source, String path) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) source.network().openConnection(new URL(BuildConfig.SITE_ORIGIN + REMOTE_PATH + path));
        connection.setInstanceFollowRedirects(false);
        connection.setConnectTimeout(6_000);
        connection.setReadTimeout(10_000);
        connection.setRequestProperty("Accept-Encoding", "identity");
        return connection;
    }

    private static boolean valid(File file, Asset asset) throws IOException {
        if (!file.isFile() || file.length() != asset.size()) return false;
        MessageDigest hash = sha256();
        try (InputStream input = new FileInputStream(file)) {
            byte[] buffer = new byte[64 * 1024];
            int length;
            while ((length = input.read(buffer)) != -1) hash.update(buffer, 0, length);
        }
        return hex(hash.digest()).equals(asset.sha256());
    }

    private static MessageDigest sha256() {
        try {
            return MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException impossible) {
            throw new AssertionError(impossible);
        }
    }

    private static String hex(byte[] bytes) {
        char[] result = new char[bytes.length * 2];
        String digits = "0123456789abcdef";
        for (int index = 0; index < bytes.length; index++) {
            result[index * 2] = digits.charAt((bytes[index] & 255) >>> 4);
            result[index * 2 + 1] = digits.charAt(bytes[index] & 15);
        }
        return new String(result);
    }

    private static void removeOtherDirectories(File root, File keep, File previous) throws IOException {
        File[] directories = root.listFiles();
        if (directories == null) return;
        for (File directory : directories) {
            if (directory.equals(keep) || directory.equals(previous)) continue;
            File[] files = directory.listFiles();
            if (files != null) for (File file : files) Files.deleteIfExists(file.toPath());
            Files.deleteIfExists(directory.toPath());
        }
    }
}
