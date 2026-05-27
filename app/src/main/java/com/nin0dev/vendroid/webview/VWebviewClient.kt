package com.nin0dev.vendroid.webview

import android.content.Intent
import android.graphics.Bitmap
import android.view.View
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.IOException

class VWebviewClient : WebViewClient() {

    companion object {
        // Single shared client — reuses connections, benefits from HTTP/2 multiplexing
        private val http = OkHttpClient()
    }

    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
        val url = request.url
        if ("discord.com" == url.authority || "about:blank" == url.toString()) {
            return false
        }
        val intent = Intent(Intent.ACTION_VIEW, url)
        view.context.startActivity(intent)
        return true
    }

    override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
        try {
            HttpClient.VencordRuntime?.let { view.evaluateJavascript(it, null) }
            HttpClient.VencordMobileRuntime?.let { view.evaluateJavascript(it, null) }
        } catch (e: Exception) {
            Toast.makeText(view.context, "Couldn't load Vencord, try restarting the app.", Toast.LENGTH_LONG).show()
        }
    }

    override fun onPageFinished(view: WebView, url: String) {
        view.visibility = View.VISIBLE
        super.onPageFinished(view, url)
    }

    override fun shouldInterceptRequest(view: WebView, req: WebResourceRequest): WebResourceResponse? {
        // Only intercept the main HTML frame — we just need to strip the CSP header so
        // Vencord can inject. Sub-resources (CSS, JS, images) go through WebView's
        // native stack which has proper caching and HTTP/2 support.
        if (!req.isForMainFrame) return null
        return try {
            doFetch(req)
        } catch (ex: IOException) {
            null
        }
    }

    private fun doFetch(req: WebResourceRequest): WebResourceResponse? {
        val builder = Request.Builder().url(req.url.toString())
        req.requestHeaders.forEach { (k, v) -> builder.addHeader(k, v) }

        val response = http.newCall(builder.build()).execute()

        // Copy headers, dropping CSP so Vencord's injection isn't blocked
        val headers = LinkedHashMap<String, String>()
        response.headers.names().forEach { name ->
            if (!name.equals("Content-Security-Policy", ignoreCase = true)) {
                response.header(name)?.let { headers[name] = it }
            }
        }

        val contentType = headers["Content-Type"] ?: "text/html"
        val mimeType = contentType.split(";")[0].trim()

        return WebResourceResponse(
            mimeType,
            "utf-8",
            response.code,
            response.message.ifEmpty { "OK" },
            headers,
            response.body?.byteStream()
        )
    }
}
