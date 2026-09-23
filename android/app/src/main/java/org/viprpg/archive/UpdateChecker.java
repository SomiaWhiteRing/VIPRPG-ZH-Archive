package org.viprpg.archive;

import android.net.Uri;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import javax.net.ssl.HttpsURLConnection;
import org.json.JSONException;
import org.json.JSONObject;

final class UpdateChecker {
    private static final String TOOL = "viprpg-android";
    private static final String CHANNEL = "stable";
    private static final String TARGET = "android-universal";

    static final class Result {
        final String status;
        final String version;
        final String notes;
        final long releaseSequence;
        final long installedSequence;
        final Uri download;
        final long versionCode;

        Result(String status, String version, String notes, long releaseSequence, long installedSequence, Uri download, long versionCode) {
            this.status = status;
            this.version = version;
            this.notes = notes;
            this.releaseSequence = releaseSequence;
            this.installedSequence = installedSequence;
            this.download = download;
            this.versionCode = versionCode;
        }

        boolean isNewer() {
            return installedSequence > 0 && releaseSequence > installedSequence && versionCode > BuildConfig.VERSION_CODE;
        }
    }

    static Result check(String origin, String buildId) throws IOException, JSONException {
        String endpoint = origin + "/api/tools/" + TOOL + "/updates/" + CHANNEL + "/" + TARGET
            + "?applicationBuildId=" + Uri.encode(buildId);
        HttpsURLConnection connection = (HttpsURLConnection) new URL(endpoint).openConnection();
        connection.setConnectTimeout(8000);
        connection.setReadTimeout(10000);
        connection.setInstanceFollowRedirects(false);
        connection.setRequestProperty("Accept", "application/json");
        connection.setRequestProperty("Cache-Control", "no-cache");
        try {
            int code = connection.getResponseCode();
            if (code == 404) return new Result("unconfigured", null, null, -1, -1, null, -1);
            if (code != 200) throw new IOException("更新服务返回 " + code);
            JSONObject data = new JSONObject(readLimited(connection.getInputStream()));
            if (data.optInt("schemaVersion") != 1 || !TOOL.equals(data.optString("tool"))
                || !CHANNEL.equals(data.optString("channel")) || !TARGET.equals(data.optString("target"))) {
                throw new IOException("更新数据格式不受支持");
            }
            if ("paused".equals(data.optString("status"))) {
                return new Result("paused", null, null, -1, -1, null, -1);
            }
            if (!"available".equals(data.optString("status"))) throw new IOException("更新状态无效");
            JSONObject artifact = data.getJSONObject("artifact");
            Uri download = Uri.parse(artifact.getString("url"));
            Uri site = Uri.parse(origin);
            if (!"apk".equals(artifact.optString("format")) || artifact.optLong("sizeBytes") <= 0
                || !artifact.optString("sha256").matches("[a-fA-F0-9]{64}")
                || !"https".equals(download.getScheme()) || !site.getHost().equalsIgnoreCase(download.getHost())
                || download.getPort() != -1 || download.getUserInfo() != null
                || download.getQuery() != null || download.getFragment() != null
                || !download.getPath().matches("/api/tool-artifacts/[a-zA-Z0-9-]+/download")) {
                throw new IOException("安装包地址或格式无效");
            }
            long sequence = data.optLong("releaseSequence", -1);
            if (sequence <= 0) throw new IOException("更新序号无效");
            String artifactBuild = artifact.optString("applicationBuildId");
            if (!artifactBuild.matches("org\\.viprpg\\.archive:[1-9][0-9]{0,9}")) throw new IOException("安装包版本标识无效");
            long versionCode = Long.parseLong(artifactBuild.substring(artifactBuild.indexOf(':') + 1));
            if (versionCode > 2100000000L) throw new IOException("安装包版本号无效");
            JSONObject installed = data.optJSONObject("installedRelease");
            long installedSequence = installed != null && buildId.equals(installed.optString("applicationBuildId"))
                ? installed.optLong("releaseSequence", -1) : -1;
            return new Result("available", data.getString("version"), data.optString("notes"), sequence, installedSequence, download, versionCode);
        } finally {
            connection.disconnect();
        }
    }

    private static String readLimited(InputStream input) throws IOException {
        try (InputStream stream = input; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[4096];
            int total = 0;
            int count;
            while ((count = stream.read(buffer)) != -1) {
                total += count;
                if (total > 128 * 1024) throw new IOException("更新数据过大");
                output.write(buffer, 0, count);
            }
            return output.toString(StandardCharsets.UTF_8.name());
        }
    }
}
