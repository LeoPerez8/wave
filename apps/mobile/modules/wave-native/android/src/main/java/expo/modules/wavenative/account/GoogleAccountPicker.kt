package expo.modules.wavenative.account

import android.accounts.AccountManager
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent

/** Asks Android for the email the owner chooses. Wave never lists the phone's accounts. */
internal object GoogleAccountPicker {
  const val REQUEST_CODE = 1
  private const val GOOGLE = "com.google"

  /**
   * False when the phone has no Google authenticator. With one but no Google account, Android's
   * picker opens its Add account screen instead; Wave can't see the accounts to skip it.
   */
  @Suppress("DEPRECATION")
  fun open(activity: Activity): Boolean {
    if (AccountManager.get(activity).authenticatorTypes.none { it.type == GOOGLE }) return false
    val picker = AccountManager.newChooseAccountIntent(null, null, arrayOf(GOOGLE), null, null, null, null)
    return try {
      activity.startActivityForResult(picker, REQUEST_CODE)
      true
    } catch (_: ActivityNotFoundException) {
      false
    }
  }

  fun email(resultCode: Int, data: Intent?): String? =
    if (resultCode == Activity.RESULT_OK && data?.getStringExtra(AccountManager.KEY_ACCOUNT_TYPE) == GOOGLE)
      data.getStringExtra(AccountManager.KEY_ACCOUNT_NAME)?.takeUnless { it.isBlank() }
    else null
}
