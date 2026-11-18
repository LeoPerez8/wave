package expo.modules.wavenative.log

import android.content.Context
import android.util.Log
import expo.modules.wavenative.log.AppLogEntry.Level

/**
 * Starts the app log on the phone: entries also go to logcat, and to the file in the app's
 * files ([AppLogFile.of]).
 */
fun WaveLog.install(context: Context) {
  echo = { level, tag, message, error ->
    when (level) {
      Level.INFO -> Log.i(tag, message, error)
      Level.WARN -> Log.w(tag, message, error)
      // Not Log.wtf for a fatal one: Android may treat that as a failure of its own.
      Level.ERROR, Level.FATAL -> Log.e(tag, message, error)
    }
  }
  writeTo(AppLogFile.of(context.applicationContext ?: context))
}

/** The app log in the app's own files. */
fun AppLogFile.Companion.of(context: Context): AppLogFile = AppLogFile.inFiles(context.filesDir)
