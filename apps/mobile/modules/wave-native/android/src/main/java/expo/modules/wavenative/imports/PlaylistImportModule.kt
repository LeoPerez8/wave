package expo.modules.wavenative.imports

import android.content.Context
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Link imports' background side ([PlaylistImportService]): JS says when
 * imports start, how far the one going on is and when none is left; Cancel
 * in the notification comes back as `onCancel`.
 */
class PlaylistImportModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private val tellCancel: () -> Unit = { sendEvent("onCancel", emptyMap<String, Any>()) }

  override fun definition() = ModuleDefinition {
    Name("WavePlaylistImport")

    Events("onCancel")

    OnCreate {
      PlaylistImportNotice.onCancel = tellCancel
    }

    OnDestroy {
      // Unless a reloaded runtime's module took over already.
      if (PlaylistImportNotice.onCancel === tellCancel) PlaylistImportNotice.onCancel = null
    }

    /** Imports started: shows their notification and keeps Wave running until [end]. */
    Function("start") { title: String, detail: String? ->
      PlaylistImportNotice.start(context, title, detail)
    }

    /** [done] of [total] songs settled, said as [title] and [detail]. */
    Function("progress") { title: String, detail: String?, done: Int, total: Int ->
      PlaylistImportNotice.progress(title, detail, done, total)
    }

    /** No import is going on any more: stops the service and takes the notification away. */
    Function("end") {
      PlaylistImportNotice.end()
    }
  }
}
