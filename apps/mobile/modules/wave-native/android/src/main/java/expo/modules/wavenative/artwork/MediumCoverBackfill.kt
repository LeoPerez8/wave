package expo.modules.wavenative.artwork

import java.io.File

/** One cached original per call, scheduled by JS on free turns. No audio files or tag readers. */
class MediumCoverBackfill(
  private val directory: File,
  private val encode: (original: File, medium: File) -> Boolean,
) {
  private val marker get() = File(directory, ".medium-v1-complete")
  private var originals: Iterator<File>? = null
  private var failed = false
  private var finished = false

  /** True when this launch's pass is done. A failed cover is tried again on the next launch. */
  @Synchronized
  fun step(): Boolean {
    if (finished || marker.isFile) return true
    val files = originals ?: (directory.listFiles() ?: emptyArray()).asSequence()
      .filter { it.isFile && !it.name.endsWith("_thumb.jpg") && ArtworkUris.hashOf(it.path) != null }
      .iterator().also { originals = it }
    if (!files.hasNext()) {
      if (!failed) {
        directory.mkdirs()
        ArtworkStore.writeAtomically(marker, byteArrayOf(1))
      }
      finished = true
      return true
    }
    val original = files.next()
    val hash = ArtworkUris.hashOf(original.path)!!
    val medium = File(directory, "${hash}_medium.jpg")
    if (!medium.isFile) {
      val written = runCatching { encode(original, medium) && medium.isFile }.getOrDefault(false)
      if (!written) failed = true
    }
    return false
  }
}
