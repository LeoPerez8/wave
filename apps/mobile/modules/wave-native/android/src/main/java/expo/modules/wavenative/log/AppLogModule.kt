package expo.modules.wavenative.log

import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.core.content.FileProvider
import com.facebook.react.bridge.ReactContext
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

/**
 * The app log's file for JS ([AppLogFile]): appending batches, reading and
 * trimming it, the phone's details for the exported file's header, and sharing
 * it from Settings › Developer › Export Logs. Core decides what goes in it.
 */
class AppLogModule : Module() {
  private val context: Context get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()
  private val log: AppLogFile get() = AppLogFile.of(context)
  private var unwatchJs: (() -> Unit)? = null

  override fun definition() = ModuleDefinition {
    Name("WaveAppLog")

    // The JS thread is watched for freezes while this runtime lives (NativeLog).
    OnCreate {
      val react = appContext.reactContext ?: return@OnCreate
      // Already started at Application.onCreate; this covers a host that didn't dispatch it.
      NativeLog.start(react)
      (react as? ReactContext)?.let { unwatchJs = NativeLog.watchJs(it) }
    }

    OnDestroy {
      unwatchJs?.invoke()
      unwatchJs = null
    }

    /** The route showing, which a freeze's entry names. */
    Function("setScreen") { path: String -> NativeLog.screen = path }

    /** Settings › Developer's debug trigger: an uncaught Kotlin exception on the main thread. */
    Function("crash") {
      Handler(Looper.getMainLooper()).post { throw DeveloperCrash("A crash from Settings › Developer") }
    }

    /** Appends formatted entries off the JS thread; resolves the log's size in bytes. */
    AsyncFunction("append") { text: String -> log.append(text).toDouble() }

    /** Appends at once, on the JS thread: for a fatal error, before the process goes. */
    Function("appendNow") { text: String -> log.append(text).toDouble() }

    AsyncFunction("read") { -> log.read() }

    /** Drops the oldest [bytes] bytes (Core's `trimLog`). */
    AsyncFunction("dropHead") { bytes: Double -> log.dropHead(bytes.toLong()) }

    /** Wave's version and build, Android's version, the phone and its font scale. */
    Function("device") {
      val packages = context.packageManager
      val info = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        packages.getPackageInfo(context.packageName, PackageManager.PackageInfoFlags.of(0))
      } else {
        @Suppress("DEPRECATION")
        packages.getPackageInfo(context.packageName, 0)
      }
      mapOf(
        "appVersion" to (info.versionName ?: "unknown"),
        "appBuild" to info.longVersionCode.toString(),
        "androidVersion" to Build.VERSION.RELEASE,
        "androidApi" to Build.VERSION.SDK_INT,
        "manufacturer" to Build.MANUFACTURER,
        "model" to Build.MODEL,
        "fontScale" to context.resources.configuration.fontScale.toDouble(),
      )
    }

    /**
     * Writes [header] and the log to `cache/logs/<fileName>` and opens the share
     * sheet with it as a `.txt` file. Earlier exports are deleted first.
     */
    AsyncFunction("share") { header: String, fileName: String ->
      val exports = File(context.cacheDir, AppLogFile.DIRECTORY)
      exports.listFiles()?.forEach { it.delete() }
      val export = File(exports, File(fileName).name)
      log.exportTo(export, header)
      val uri = FileProvider.getUriForFile(context, "${context.packageName}.logs", export)
      val send = Intent(Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(Intent.EXTRA_STREAM, uri)
        putExtra(Intent.EXTRA_SUBJECT, export.name)
        clipData = ClipData.newRawUri(export.name, uri)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      }
      val chooser = Intent.createChooser(send, "Export Logs")
      val activity = appContext.currentActivity
      if (activity != null) {
        activity.runOnUiThread { activity.startActivity(chooser) }
      } else {
        context.startActivity(chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      }
    }
  }
}

/** The crash Settings › Developer forces in a debug build, to see it in the next export. */
class DeveloperCrash(message: String) : RuntimeException(message)
