package com.castboxtv.app.dlna

import android.util.Log
import org.eclipse.jetty.server.Server
import org.eclipse.jetty.servlet.ServletContextHandler
import org.eclipse.jetty.servlet.ServletHolder
import org.json.JSONObject
import java.io.IOException
import javax.servlet.http.HttpServlet
import javax.servlet.http.HttpServletRequest
import javax.servlet.http.HttpServletResponse

object SseManager {

    private var registered = false
    private var sseServer: Server? = null

    val ssePort: Int get() = sseServer?.connectors?.firstOrNull()?.localPort ?: 0

    fun registerServlets() {
        if (registered) return
        registered = true
        Thread {
            try {
                val ctx = ServletContextHandler(ServletContextHandler.SESSIONS).apply {
                    contextPath = "/"
                    addServlet(ServletHolder(SseServlet()), "/upnp/sse")
                    addServlet(ServletHolder(StateServlet()), "/upnp/state")
                    addServlet(ServletHolder(UserActionServlet()), "/upnp/user-action")
                }
                val server = Server(49201)
                server.handler = ctx
                server.start()
                sseServer = server
                Log.d("DLNA", "SSE server started on port 49201")
            } catch (e: Exception) {
                Log.e("DLNA", "Failed to start SSE server", e)
            }
        }.start()
    }

    fun shutdown() {
        try {
            sseServer?.stop()
            sseServer = null
            registered = false
        } catch (_: Exception) {}
    }

    fun buildStateJson(): String = JSONObject().apply {
        put("state", DlnaRendererState.transportState.name)
        put("title", DlnaRendererState.currentTitle)
        put("artist", DlnaRendererState.currentArtist)
        put("album", DlnaRendererState.currentAlbum)
        put("artworkUrl", DlnaRendererState.currentArtworkUrl ?: "")
        put("position", DlnaRendererState.currentPosition)
        put("duration", DlnaRendererState.duration)
        put("volume", DlnaRendererState.overlayVolume)
        put("userAction", DlnaRendererState.userAction)
    }.toString()
}

private fun addCorsHeaders(resp: HttpServletResponse) {
    resp.setHeader("Access-Control-Allow-Origin", "*")
    resp.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    resp.setHeader("Access-Control-Allow-Headers", "Content-Type")
}

class SseServlet : HttpServlet() {
    override fun doGet(req: HttpServletRequest, resp: HttpServletResponse) {
        addCorsHeaders(resp)
        resp.contentType = "text/event-stream; charset=utf-8"
        resp.setHeader("Cache-Control", "no-cache")
        resp.setHeader("Connection", "keep-alive")

        try {
            val writer = resp.writer
            while (true) {
                writer.write("data: ${SseManager.buildStateJson()}\n\n")
                writer.flush()
                Thread.sleep(500)
            }
        } catch (_: IOException) {
        } catch (_: InterruptedException) {
        }
    }
}

class StateServlet : HttpServlet() {
    override fun doGet(req: HttpServletRequest, resp: HttpServletResponse) {
        addCorsHeaders(resp)
        resp.contentType = "application/json"
        resp.writer.write(SseManager.buildStateJson())
    }
}

class UserActionServlet : HttpServlet() {
    override fun doGet(req: HttpServletRequest, resp: HttpServletResponse) {
        addCorsHeaders(resp)
        val action = req.getParameter("action")
        if (action != null) {
            DlnaRendererState.userAction = action
            Log.d("DLNA", "userAction set to: $action (via GET)")
            resp.contentType = "application/json"
            resp.writer.write(JSONObject().apply {
                put("status", "ok")
                put("action", action)
            }.toString())
        } else {
            resp.contentType = "application/json"
            resp.writer.write(JSONObject().apply {
                put("userAction", DlnaRendererState.userAction)
            }.toString())
        }
    }
}
