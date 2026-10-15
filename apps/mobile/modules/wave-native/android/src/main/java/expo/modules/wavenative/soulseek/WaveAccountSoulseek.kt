package expo.modules.wavenative.soulseek

/**
 * The Soulseek account the Wave account keeps (docs/spec.md, "The Soulseek account"). Only
 * native code reaches it, so the credentials never pass through JS.
 */
interface WaveAccountSoulseek {
  /** Whether the phone is signed in to a Wave account. */
  fun signedIn(): Boolean

  /** The Wave account's Soulseek account, or null when it has none. Throws when it can't tell. */
  fun read(): SoulseekCredentials?

  /** Keeps [account] as the Wave account's, replacing the one it had. Throws when it can't. */
  fun keep(account: SoulseekCredentials)
}

/** A phone with no Wave account: the Soulseek account is the phone's alone. */
object NoWaveAccount : WaveAccountSoulseek {
  override fun signedIn() = false
  override fun read(): SoulseekCredentials? = null
  override fun keep(account: SoulseekCredentials) = Unit
}
