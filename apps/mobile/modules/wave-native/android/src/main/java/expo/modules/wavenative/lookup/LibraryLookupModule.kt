package expo.modules.wavenative.lookup

import android.content.Context
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * The whole-Library lyrics and genre run's background side
 * ([LibraryLookupService]): JS says when it starts, how far it is and how it
 * ended; Cancel in the notification comes back as `onCancel`.
 */
class LibraryLookupModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private val tellCancel: () -> Unit = { sendEvent("onCancel", emptyMap<String, Any>()) }

  override fun definition() = ModuleDefinition {
    Name("WaveLibraryLookup")

    Events("onCancel")

    OnCreate {
      LibraryLookupNotice.onCancel = tellCancel
    }

    OnDestroy {
      // Unless a reloaded runtime's module took over already.
      if (LibraryLookupNotice.onCancel === tellCancel) LibraryLookupNotice.onCancel = null
    }

    /** The run started: shows its notification and keeps Wave running until [end]. */
    Function("start") { title: String, detail: String? ->
      LibraryLookupNotice.start(context, title, detail)
    }

    /** [done] of [total] songs looked up, said as [title] and [detail]. */
    Function("progress") { title: String, detail: String?, done: Int, total: Int ->
      LibraryLookupNotice.progress(title, detail, done, total)
    }

    /** The run ended: stops the service and shows [title] and [message] in a notification (none when null). */
    Function("end") { title: String?, message: String? ->
      LibraryLookupNotice.end(context, if (title != null && message != null) title to message else null)
    }

    /** The owner saw the summary in Wave: takes its notification away. */
    Function("dismissSummary") {
      LibraryLookupNotice.dismissSummary(context)
    }
  }
}
