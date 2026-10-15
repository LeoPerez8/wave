package expo.modules.wavenative.account

import android.app.Activity
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.NoCredentialException
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.google.android.libraries.identity.googleid.GoogleIdTokenParsingException

/**
 * Android's Google account picker (Credential Manager, not a web view): an ID token for Wave's
 * web client [webClientId], or null when the owner backs out.
 */
object GoogleSignIn {
  suspend fun pick(activity: Activity, webClientId: String): GoogleIdentity? {
    val request = GetCredentialRequest.Builder()
      .addCredentialOption(GetSignInWithGoogleOption.Builder(webClientId).build())
      .build()
    val credential = try {
      CredentialManager.create(activity).getCredential(activity, request).credential
    } catch (_: GetCredentialCancellationException) {
      return null
    } catch (e: NoCredentialException) {
      throw WaveAccountException(WaveAccountFailure.NO_GOOGLE_ACCOUNT, e)
    } catch (e: GetCredentialException) {
      throw WaveAccountException(WaveAccountFailure.GOOGLE, e)
    }
    if (credential !is CustomCredential || credential.type != GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL)
      throw WaveAccountException(WaveAccountFailure.GOOGLE)
    val google = try { GoogleIdTokenCredential.createFrom(credential.data) }
    catch (e: GoogleIdTokenParsingException) { throw WaveAccountException(WaveAccountFailure.GOOGLE, e) }
    return GoogleIdentity(
      idToken = google.idToken,
      email = google.id.takeIf { "@" in it },
      name = google.displayName,
      photoUrl = google.profilePictureUri?.toString(),
    )
  }
}
