package expo.modules.wavenative.soulseek

data class SoulseekCandidate(
  val username: String,
  val filename: String,
  val bytes: Long,
  val bitrateKbps: Int?,
  val durationMs: Long?,
  val freeSlot: Boolean,
  val uploadSpeed: Long,
  val queueLength: Long,
) {
  fun toMap(): Map<String, Any?> = mapOf(
    "username" to username, "filename" to filename, "bytes" to bytes.toDouble(),
    "bitrateKbps" to bitrateKbps, "durationMs" to durationMs?.toDouble(), "freeSlot" to freeSlot,
    "uploadSpeed" to uploadSpeed.toDouble(), "queueLength" to queueLength.toDouble(),
  )

  companion object {
    fun fromJs(value: Map<String, Any?>): SoulseekCandidate {
      fun number(key: String) = (value[key] as? Number)?.toLong()
      val user = value["username"] as? String ?: throw SoulseekException(SoulseekFailure.PROTOCOL)
      val path = value["filename"] as? String ?: throw SoulseekException(SoulseekFailure.PROTOCOL)
      val bytes = number("bytes") ?: 0
      if (user.isBlank() || user.length > 30 || path.isBlank() || path.length > 4096 || bytes !in 1..MAX_AUDIO_BYTES) {
        throw SoulseekException(SoulseekFailure.PROTOCOL)
      }
      return SoulseekCandidate(user, path, bytes, number("bitrateKbps")?.toInt(), number("durationMs"),
        value["freeSlot"] == true, number("uploadSpeed") ?: 0, number("queueLength") ?: 0)
    }
    const val MAX_AUDIO_BYTES = 512L * 1024 * 1024
  }
}
