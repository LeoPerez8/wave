package expo.modules.wavenative.log

import androidx.core.content.FileProvider

/**
 * Hands the exported log to the app the owner shares it with, as a content URI
 * (`res/xml/wave_log_paths.xml`: the cache's `logs` folder only). A class of its
 * own so its manifest entry can't clash with another library's FileProvider.
 */
class AppLogFileProvider : FileProvider()
