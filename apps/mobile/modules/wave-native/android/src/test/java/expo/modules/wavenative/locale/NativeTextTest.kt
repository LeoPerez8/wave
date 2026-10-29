package expo.modules.wavenative.locale

import org.junit.Assert.*
import org.junit.Test
import expo.modules.wavenative.player.AutoModes
import expo.modules.wavenative.player.PlaybackModes
import expo.modules.wavenative.player.AutoLyrics
import expo.modules.wavenative.player.MoreFromArtist

class NativeTextTest {
  @Test fun controlsAndNotificationsFollowTheResolvedLanguage() {
    try {
      NativeText.publish("pt-BR")
      assertEquals("Embaralhar desativado", AutoModes.buttons(PlaybackModes()).first().label)
      assertEquals("Letra ativada", AutoLyrics.label(true))
      assertEquals("Mais deste artista", MoreFromArtist.LABEL)
      assertEquals("Salvando na Biblioteca", NativeText.get("saving"))
      NativeText.publish("en")
      assertEquals("Shuffle off", AutoModes.buttons(PlaybackModes()).first().label)
      assertEquals("Saving to the Library", NativeText.get("saving"))
    } finally { NativeText.publish("en") }
  }

  @Test fun languageChangesNotifyWithoutPlaybackCommands() {
    NativeText.publish("en")
    var changes = 0
    val stop = NativeText.listen { changes++ }
    try {
      NativeText.publish("pt-BR")
      NativeText.publish("pt-BR")
      NativeText.publish("en")
      assertEquals(2, changes)
    } finally { stop(); NativeText.publish("en") }
  }
}
