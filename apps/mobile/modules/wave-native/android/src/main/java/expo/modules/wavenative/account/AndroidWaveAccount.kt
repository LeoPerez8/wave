package expo.modules.wavenative.account

import android.content.Context
import expo.modules.wavenative.net.Connectivity
import expo.modules.wavenative.secrets.KeystoreCipher
import java.io.File

/**
 * The Wave account client for the whole app process, so native code (the Soulseek account,
 * syncing) and the Expo module share one session. Its token lives in noBackupFilesDir,
 * encrypted with a Keystore key: never in JS's key-value store, never in a backup.
 */
class AndroidWaveAccount private constructor(context: Context) {
  val connectivity = Connectivity(context)
  val client = WaveAccountClient(
    WaveAccountStore(File(context.noBackupFilesDir, "wave-account-session"), KeystoreCipher("wave-account-session-v1")),
    online = connectivity::online,
  )

  companion object {
    @Volatile private var instance: AndroidWaveAccount? = null
    fun get(context: Context): AndroidWaveAccount = instance ?: synchronized(this) {
      instance ?: AndroidWaveAccount(context.applicationContext).also { instance = it }
    }
  }
}
