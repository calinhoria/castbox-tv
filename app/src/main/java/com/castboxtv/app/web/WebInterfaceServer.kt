package com.castboxtv.app.web

import android.util.Log
import com.castboxtv.app.audio.CrossfadeAlgorithm
import com.castboxtv.app.dlna.DlnaMediaService
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStream
import java.net.ServerSocket
import java.net.Socket
import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.fourthline.cling.support.model.TransportState

class WebInterfaceServer(
    private val service: DlnaMediaService,
    private val port: Int = 8092
) {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var serverJob: Job? = null

    fun start() {
        stop()
        serverJob = scope.launch {
            try {
                ServerSocket(port).use { serverSocket ->
                    Log.d(TAG, "web server listening on $port")
                    while (isActive) {
                        val socket = serverSocket.accept()
                        launch { handleClient(socket) }
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "web server failed", e)
            }
        }
    }

    fun stop() {
        serverJob?.cancel()
        serverJob = null
    }

    private fun handleClient(socket: Socket) {
        try {
            socket.use { s ->
                val reader = BufferedReader(InputStreamReader(s.getInputStream(), StandardCharsets.UTF_8))
                val out = s.getOutputStream()

                val requestLine = reader.readLine() ?: return
                val parts = requestLine.split(" ")
                if (parts.size < 2) return
                val method = parts[0].uppercase()
                val fullPath = parts[1]

                val headers = mutableMapOf<String, String>()
                while (true) {
                    val line = reader.readLine() ?: break
                    if (line.isBlank()) break
                    val idx = line.indexOf(":")
                    if (idx > 0) {
                        headers[line.substring(0, idx).trim().lowercase()] = line.substring(idx + 1).trim()
                    }
                }

                val contentLength = headers["content-length"]?.toIntOrNull() ?: 0
                val body = if (contentLength > 0) {
                    val bodyChars = CharArray(contentLength)
                    var read = 0
                    while (read < contentLength) {
                        val r = reader.read(bodyChars, read, contentLength - read)
                        if (r < 0) break
                        read += r
                    }
                    String(bodyChars, 0, read)
                } else {
                    ""
                }

                val path = fullPath.substringBefore("?")
                val query = fullPath.substringAfter("?", "")

                route(method, path, query, body, out)
            }
        } catch (e: Exception) {
            Log.w(TAG, "client handler error", e)
        }
    }

    private fun route(method: String, path: String, query: String, body: String, out: OutputStream) {
        when {
            path == "/" || path == "/index.html" -> respondHtml(out, indexHtml())
            path.startsWith("/web/") -> serveWebAsset(path, out)
            path == "/api/status" -> respondJson(out, statusJson())
            // The Studio's own URLs (js/main.js, css/app.css, assets/...) are
            // document-relative, so /studio without the trailing slash resolves
            // them to /js/... and the page never boots. Redirect instead of
            // serving index.html into a dead document.
            path == "/studio" -> redirect(out, "/studio/")
            path.startsWith("/studio/") -> serveStudioAsset(path, out)
            path == "/api/viz-presets" && method == "GET" -> respondJson(out, vizPresetsJson(query))
            path == "/api/viz-test" -> {
                val params = parseParams(query, body)
                respondJson(out, service.vizRenderTest(params["name"] ?: ""))
            }
            path == "/api/viz-blur" -> respondJson(out, service.vizBlurTest())
            path == "/api/viz-preset" && method == "POST" -> {
                val params = parseParams(query, body)
                val action = params["action"] ?: "save"
                val result = when (action) {
                    "delete" -> {
                        val ok = service.deleteVizPreset(params["name"] ?: "")
                        "{\"ok\":$ok}"
                    }
                    "restore" -> {
                        val n = service.restoreVizPresets()
                        "{\"ok\":true,\"count\":$n}"
                    }
                    else -> {
                        val json = params["json"] ?: ""
                        val name = if (json.isNotBlank()) service.saveVizPreset(json) else null
                        if (name != null) "{\"ok\":true,\"name\":\"${escapeJson(name)}\"}"
                        else "{\"ok\":false,\"error\":\"bad preset json\"}"
                    }
                }
                respondJson(out, result)
            }
            path == "/api/settings" && method == "POST" -> {
                applySettings(parseParams(query, body))
                respondJson(out, statusJson())
            }
            path == "/api/display" && method == "POST" -> {
                val params = parseParams(query, body)
                params["name"]?.let { service.updateDisplayName(it) }
                respondJson(out, statusJson())
            }
            path == "/api/restart" && method == "POST" -> {
                respondJson(out, "{\"ok\":true,\"message\":\"restarting\"}")
                service.restartApp()
            }
            else -> respond(out, 404, "text/plain", "Not found")
        }
    }

    private fun applySettings(params: Map<String, String>) {
        params["crossfadeEnabled"]?.toBooleanOrFlag()?.let { service.setCrossfadeEnabled(it) }
        params["crossfadeDuration"]?.toIntOrNull()?.let { service.setCrossfadeDuration(it.coerceIn(3, 12)) }
        params["crossfadeAlgorithm"]?.let { raw ->
            CrossfadeAlgorithm.entries.firstOrNull { it.name.equals(raw, ignoreCase = true) }?.let {
                service.setCrossfadeAlgorithm(it)
            }
        }

        params["appVizEnabled"]?.toBooleanOrFlag()?.let { service.setAppVizEnabled(it) }
        params["appVizPreset"]?.let { service.setAppVizPreset(it) }
        if (params["appVizNext"]?.toBooleanOrFlag() == true) service.nextAppVizPreset()
        if (params["appVizRandom"]?.toBooleanOrFlag() == true) service.randomAppVizPreset()
        params["appVizCycle"]?.toBooleanOrFlag()?.let { service.setAppVizCycle(it) }
        params["appVizCycleSecs"]?.toIntOrNull()?.let { service.setAppVizCycleSecs(it.coerceIn(5, 120)) }
        params["appVizUseCoverPalette"]?.toBooleanOrFlag()?.let { service.setAppVizUseCoverPalette(it) }
        params["appVizShowFps"]?.toBooleanOrFlag()?.let { service.setAppVizShowFps(it) }
        params["appVizPack"]?.let { service.setAppVizPack(it) }
        params["appVizShowName"]?.toBooleanOrFlag()?.let { service.setAppVizShowName(it) }
        params["appVizMockAudio"]?.toBooleanOrFlag()?.let { service.setAppVizMockAudio(it) }
        if (params["appVizFavoriteToggle"]?.toBooleanOrFlag() == true) {
            service.toggleAppVizFavorite(service.getAppVizPreset())
        }
    }

    private fun parseParams(query: String, body: String): Map<String, String> {
        val map = mutableMapOf<String, String>()
        fun parse(s: String) {
            if (s.isBlank()) return
            for (pair in s.split("&")) {
                val idx = pair.indexOf("=")
                if (idx < 0) {
                    map[URLDecoder.decode(pair, StandardCharsets.UTF_8.name())] = ""
                } else {
                    val key = URLDecoder.decode(pair.substring(0, idx), StandardCharsets.UTF_8.name())
                    val value = URLDecoder.decode(pair.substring(idx + 1), StandardCharsets.UTF_8.name())
                    map[key] = value
                }
            }
        }
        parse(query)
        parse(body)
        return map
    }


    private fun statusJson(): String {
        val state = com.castboxtv.app.dlna.DlnaRendererState
        val playing = state.transportState == TransportState.PLAYING
        return buildString {
            append("{")
            append("\"playing\":$playing,")
            append("\"title\":\"${escapeJson(service.getCurrentTitle())}\",")
            append("\"artist\":\"${escapeJson(service.getCurrentArtist())}\",")
            append("\"album\":\"${escapeJson(service.getCurrentAlbum())}\",")
            append("\"position\":${state.currentPosition},")
            append("\"duration\":${state.duration},")
            append("\"crossfadeEnabled\":${service.isCrossfadeEnabled()},")
            append("\"crossfadeDuration\":${service.getCrossfadeDuration()},")
            append("\"crossfadeAlgorithm\":\"${service.getCrossfadeAlgorithm().name}\",")
            append("\"displayName\":\"${escapeJson(service.getDisplayName())}\",")
            append("\"appVizEnabled\":${service.isAppVizEnabled()},")
            append("\"appVizPreset\":\"${escapeJson(service.getAppVizPreset())}\",")
            append("\"appVizCycle\":${service.isAppVizCycle()},")
            append("\"appVizCycleSecs\":${service.getAppVizCycleSecs()},")
            append("\"appVizUseCoverPalette\":${service.isAppVizUseCoverPalette()},")
            append("\"appVizShowFps\":${service.isAppVizShowFps()},")
            append("\"appVizPack\":\"${service.getAppVizPack()}\",")
            append("\"appVizShowName\":${service.isAppVizShowName()},")
            append("\"appVizMockAudio\":${service.isAppVizMockAudio()},")
            append("\"appVizFavorites\":[")
            service.getAppVizFavorites().forEachIndexed { i, name ->
                if (i > 0) append(",")
                append("\"${escapeJson(name)}\"")
            }
            append("],")
            append("\"appVizIsFavorite\":${service.isAppVizFavorite(service.getAppVizPreset())},")
            append("\"appVizFavoritesVersion\":${service.getAppVizFavoritesVersion()},")
                      append("\"appVizPresets\":[")
            service.getAppVizPresetNames().forEachIndexed { i, name ->
                if (i > 0) append(",")
                append("\"${escapeJson(name)}\"")
            }
            append("]")
            append("}")
        }
    }

    private fun indexHtml(): String {
        val algorithms = CrossfadeAlgorithm.entries.joinToString("") {
            "<option value=\"${it.name}\">${escapeHtml(it.displayName)}</option>"
        }
        val page = service.assets.open("web/index.html").use { String(it.readBytes(), Charsets.UTF_8) }
        return page.replace("{{ALGORITHMS}}", algorithms)
    }

    // --- Settings page assets (assets/web, built by webui/) ------------------
    private fun serveWebAsset(path: String, out: OutputStream) {
        val rel = path.removePrefix("/web/").substringBefore("?")
        if (".." in rel || rel.isBlank()) {
            respond(out, 404, "text/plain", "Not found")
            return
        }
        try {
            service.assets.open("web/$rel").use { input ->
                respondBytes(out, 200, studioContentType(rel), input.readBytes())
            }
        } catch (e: Exception) {
            respond(out, 404, "text/plain", "Not found")
        }
    }

    private fun respondHtml(out: OutputStream, body: String) = respond(out, 200, "text/html; charset=utf-8", body)
    private fun respondJson(out: OutputStream, body: String) = respond(out, 200, "application/json; charset=utf-8", body)

    // --- Visualiser Studio (served from assets/studio at /studio/) -----------
    private fun studioContentType(name: String): String = when {
        name.endsWith(".html") -> "text/html; charset=utf-8"
        name.endsWith(".css") -> "text/css; charset=utf-8"
        name.endsWith(".js") || name.endsWith(".mjs") -> "text/javascript; charset=utf-8"
        name.endsWith(".json") -> "application/json; charset=utf-8"
        name.endsWith(".wasm") -> "application/wasm"
        name.endsWith(".woff2") -> "font/woff2"
        name.endsWith(".ttf") -> "font/ttf"
        name.endsWith(".png") -> "image/png"
        name.endsWith(".jpg") || name.endsWith(".jpeg") -> "image/jpeg"
        else -> "application/octet-stream"
    }

    private fun serveStudioAsset(path: String, out: OutputStream) {
        val rel = path.removePrefix("/studio/").substringBefore("?")
        if (".." in rel) {
            respond(out, 404, "text/plain", "Not found")
            return
        }
        val assetPath = if (rel.isBlank() || rel == "/studio" || rel == "/") "studio/index.html" else "studio/$rel"
        try {
            service.assets.open(assetPath).use { input ->
                val bytes = input.readBytes()
                respondBytes(out, 200, studioContentType(assetPath), bytes)
            }
        } catch (_: Exception) {
            respond(out, 404, "text/plain", "Not found")
        }
    }


    private fun vizPresetsJson(query: String): String = buildString {
        append("{\"presets\":[")
        service.getVizPresetNames().forEachIndexed { i, name ->
            if (i > 0) append(",")
            append("\"${escapeJson(name)}\"")
        }
        append("]")
        if ("full=1" in query) {
            append(",\"full\":[")
            service.getVizPresetFullJsons().forEachIndexed { i, json ->
                if (i > 0) append(",")
                append(json)
            }
            append("]")
            append(",\"user\":[")
            service.getVizPresetUserNames().forEachIndexed { i, name ->
                if (i > 0) append(",")
                append("\"${escapeJson(name)}\"")
            }
            append("]")
        }
        append("}")
    }

    private fun respond(out: OutputStream, code: Int, contentType: String, body: String) {
        respondBytes(out, code, contentType, body.toByteArray(StandardCharsets.UTF_8))
    }

    /**301 to [location]; the browser then resolves relative URLs against it. */
    private fun redirect(out: OutputStream, location: String) {
        val body = "moved to $location"
        val bytes = body.toByteArray(StandardCharsets.UTF_8)
        out.write(
            ("HTTP/1.1 301 Moved Permanently\r\n" +
            "Location: $location\r\n" +
            "Content-Type: text/plain; charset=utf-8\r\n" +
            "Content-Length: ${bytes.size}\r\n" +
            "Connection: close\r\n\r\n").toByteArray(StandardCharsets.UTF_8))
        out.write(bytes)
        out.flush()
    }

    private fun respondBytes(out: OutputStream, code: Int, contentType: String, bytes: ByteArray) {
        val status = if (code == 200) "200 OK" else "$code"
        out.write(
            ("HTTP/1.1 $status\r\n" +
            "Content-Type: $contentType\r\n" +
            "Content-Length: ${bytes.size}\r\n" +
            "Connection: close\r\n" +
            "Access-Control-Allow-Origin: *\r\n" +
            "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n" +
            "Access-Control-Allow-Headers: Content-Type\r\n" +
            "\r\n").toByteArray(StandardCharsets.UTF_8)
        )
        out.write(bytes)
        out.flush()
    }

    private fun String.toBooleanOrFlag(): Boolean {
        return this.equals("true", ignoreCase = true) || this == "1" || this.equals("on", ignoreCase = true)
    }

    private fun escapeJson(s: String): String {
        return s.replace("\\", "\\\\")
            .replace("\"", "\\\"")
            .replace("\b", "\\b")
            .replace("\n", "\\n")
            .replace("\r", "\\r")
            .replace("\t", "\\t")
    }

    private fun escapeHtml(s: String): String {
        return s.replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace("\"", "&quot;")
    }


    companion object {
        private const val TAG = "WebInterface"
    }
}
