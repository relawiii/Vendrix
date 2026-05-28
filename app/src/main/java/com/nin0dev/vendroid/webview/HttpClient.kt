package com.nin0dev.vendroid.webview

import android.app.Activity
import android.content.Context
import android.util.Log
import android.widget.Toast
import com.nin0dev.vendroid.BuildConfig
import com.nin0dev.vendroid.R
import com.nin0dev.vendroid.utils.Constants
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.Locale

object HttpClient {
    @JvmField
    var VencordRuntime: String? = null
    @JvmField
    var VencordMobileRuntime: String? = null

    /** Show a Toast safely from any thread. */
    private fun Activity.showToast(message: String, duration: Int = Toast.LENGTH_SHORT) {
        runOnUiThread { Toast.makeText(this, message, duration).show() }
    }

    /**
     * Returns true if the APK contains a custom-built Vencord bundle
     * (i.e. build-vencord.sh was run and wrote vencord_bundle.js).
     * Detected by the metadata comment injected by build-vencord.sh.
     */
    private fun hasBuiltBundle(activity: Activity): Boolean {
        return try {
            val res = activity.resources.openRawResource(R.raw.vencord_bundle)
            val firstLine = res.bufferedReader().readLine() ?: ""
            res.close()
            firstLine.startsWith("// VendroidEnhanced custom Vencord bundle")
        } catch (_: Exception) {
            false
        }
    }

    @JvmStatic
    @Throws(IOException::class)
    fun fetchVencord(activity: Activity) {
        val sPrefs = activity.getSharedPreferences("settings", Context.MODE_PRIVATE)
        val e = sPrefs.edit()
        val res = activity.resources

        // Always load the mobile shim
        res.openRawResource(R.raw.vencord_mobile).use { VencordMobileRuntime = readAsText(it) }

        if (VencordRuntime != null) return

        // ── Priority 1: Custom-built bundle embedded in the APK ──────────────
        if (hasBuiltBundle(activity)) {
            Log.i("VendroidEnhanced", "Loading custom-built Vencord bundle from APK resources")
            res.openRawResource(R.raw.vencord_bundle).use { VencordRuntime = readAsText(it) }
            if (BuildConfig.DEBUG) {
                activity.showToast("Loaded custom Vencord bundle from APK")
            }
            return
        }

        // ── Priority 2: Cached CDN download (original behaviour) ─────────────
        val bundleURLToUse = if (sPrefs.getString("clientMod", "vencord") == "equicord")
            Constants.EQUICORD_BUNDLE_URL else Constants.JS_BUNDLE_URL

        val vendroidFile = File(activity.filesDir, "vencord.js")

        if (sPrefs.getInt("lastMajorUpdateThatUserHasUpdatedVencord", 0) < BuildConfig.VERSION_CODE) {
            if (BuildConfig.DEBUG)
                activity.showToast("App updated, re-downloading Vencord", Toast.LENGTH_LONG)
            vendroidFile.delete()
        }

        val customLocation = sPrefs.getString("vencordLocation", bundleURLToUse)
        if ((customLocation != Constants.JS_BUNDLE_URL && customLocation != Constants.EQUICORD_BUNDLE_URL)
            || BuildConfig.DEBUG
        ) {
            activity.showToast(
                "Debugging app or Vencord, bundle will be re-downloaded. Avoid on limited networks",
                Toast.LENGTH_LONG
            )
            vendroidFile.delete()
        }

        if (vendroidFile.exists()) {
            VencordRuntime = vendroidFile.readText()
        } else {
            Log.i("VendroidEnhanced", "Downloading Vencord from CDN: $customLocation")
            val conn = fetch(customLocation!!)
            val text = readAsText(conn.inputStream)
            vendroidFile.writeText(text)
            e.putInt("lastMajorUpdateThatUserHasUpdatedVencord", BuildConfig.VERSION_CODE)
            e.apply()
            VencordRuntime = text
        }
    }

    @Throws(IOException::class)
    fun fetch(url: String?): HttpURLConnection {
        val conn = URL(url).openConnection() as HttpURLConnection
        if (conn.responseCode >= 300) throw HttpException(conn)
        return conn
    }

    @Throws(IOException::class)
    fun readAsText(`is`: InputStream): String {
        ByteArrayOutputStream().use { baos ->
            var n: Int
            val buf = ByteArray(16384)
            while (`is`.read(buf).also { n = it } > -1) baos.write(buf, 0, n)
            baos.flush()
            return baos.toString("UTF-8")
        }
    }

    class HttpException(private val conn: HttpURLConnection) : IOException() {
        override var message: String? = null
            get() {
                if (field == null) {
                    try {
                        conn.errorStream.use { es ->
                            field = String.format(
                                Locale.ENGLISH, "%d: %s (%s)\n%s",
                                conn.responseCode, conn.responseMessage,
                                conn.url.toString(), readAsText(es)
                            )
                        }
                    } catch (ex: IOException) {
                        field = "Error while building message. URL: ${conn.url}"
                    }
                }
                return field
            }
            private set
    }
}
