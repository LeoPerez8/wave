package expo.modules.wavenative.spotify

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SpotifyTotpTest {
  @Test
  fun codesMatchRfc6238sSha1Vectors() {
    val key = "12345678901234567890".toByteArray()
    assertEquals("287082", SpotifyTotp.code(key, 59_000))
    assertEquals("081804", SpotifyTotp.code(key, 1_111_111_109_000))
  }

  @Test
  fun theWebPlayersSecretDecodesToTheKeyItSignsWith() {
    // Expected values from Node's crypto with the research's decoding (docs/spotify-account.md).
    val secret = SpotifySecret(",7/*F(\"rLJ2oxaKL^f+E1xvP@N", 61)
    assertEquals("376136387538459893883312310911992847112448894410210511297108", String(secret.key()))
    assertEquals("103443", SpotifyTotp.code(secret.key(), 1_792_361_453_000))
    assertEquals("same 30-second step", "103443", SpotifyTotp.code(secret.key(), 1_792_361_453_000 + 6_000))
    assertEquals("931073", SpotifyTotp.code(secret.key(), 1_792_361_482_000))
  }

  @Test
  fun aNewSecretIsReadFromTheWebPlayersBundle() {
    val bundle = """a=1;let ej=[{secret:'OmE{ZA.J^":0FG\\Uz?[@WW',version:62},{secret:",7/*F(\"x",version:61}].map(e=>e)"""
    // The first entry is the one in use; JS escapes in it are undone.
    assertEquals(SpotifySecret("OmE{ZA.J^\":0FG\\Uz?[@WW", 62), SpotifySecret.fromBundle(bundle))
    assertNull(SpotifySecret.fromBundle("no secret here"))
  }
}
