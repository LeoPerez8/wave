package expo.modules.wavenative.recognize

import android.content.Context
import android.content.Intent

/** Reuses MainActivity and its current screen/session, including with another app in front. */
fun recognizeIntent(context: Context): Intent = Intent(RecognizeInbox.ACTION)
  .setClassName(context.packageName, "${context.packageName}.MainActivity")
  .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
