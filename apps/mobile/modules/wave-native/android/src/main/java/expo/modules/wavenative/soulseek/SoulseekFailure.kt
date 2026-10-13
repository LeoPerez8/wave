package expo.modules.wavenative.soulseek

import java.io.IOException

enum class SoulseekFailure(val code: String, val notice: String) {
  SIGNED_OUT("ERR_SLSK_SIGNED_OUT", "Connect a Soulseek account in Settings"),
  AUTH("ERR_SLSK_AUTH", "Soulseek rejected the account. Check your username and password"),
  OFFLINE("ERR_SLSK_OFFLINE", "Couldn't connect to Soulseek. Retry when you're online"),
  PEER("ERR_SLSK_PEER", "The peer is unavailable. Retry the download"),
  QUEUED("ERR_SLSK_QUEUED", "The peer queue took too long. Retry the download"),
  INVALID_AUDIO("ERR_SLSK_INVALID_AUDIO", "The received file isn't a complete MP3 320 recording"),
  CANCELLED("ERR_SLSK_CANCELLED", "Download cancelled"),
  STORAGE("ERR_SLSK_STORAGE", "Couldn't save the download"),
  PROTOCOL("ERR_SLSK_PROTOCOL", "Soulseek sent an invalid response"),
}

class SoulseekException(val failure: SoulseekFailure, message: String = failure.notice, cause: Throwable? = null) :
  IOException(message, cause)
