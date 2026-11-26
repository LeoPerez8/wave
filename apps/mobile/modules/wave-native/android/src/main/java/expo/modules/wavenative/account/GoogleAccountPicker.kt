package expo.modules.wavenative.account

import android.accounts.AccountManager
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.os.Bundle

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

/**
 * The account choice a sign-in screen (Spotify's, YT Music's) opens with: Android's picker, then
 * [openPage] with the email chosen, or null with none or no picker. It keeps whether the picker is
 * open across the activity being recreated, so a recreated screen waits for the picker's result;
 * recreated after the page opened, the screen opens a fresh page.
 */
internal class GoogleAccountChoice(
  private val activity: Activity,
  private val openPage: (email: String?) -> Unit,
) {
  private var picking = true

  /** From onCreate: an [email] known already opens the page with it; else the picker shows. */
  fun start(savedInstanceState: Bundle?, email: String? = null) {
    if (savedInstanceState?.getBoolean(PICKING) == true) return
    if (email != null) page(email)
    else if (savedInstanceState != null || !GoogleAccountPicker.open(activity)) page(null)
  }

  /** From onSaveInstanceState. */
  fun save(outState: Bundle) {
    outState.putBoolean(PICKING, picking)
  }

  /** From onActivityResult: the picker's answer opens the page. */
  fun result(requestCode: Int, resultCode: Int, data: Intent?) {
    if (requestCode == GoogleAccountPicker.REQUEST_CODE) page(GoogleAccountPicker.email(resultCode, data))
  }

  private fun page(email: String?) {
    picking = false
    openPage(email)
  }

  private companion object {
    const val PICKING = "pickingAccount"
  }
}
