package expo.modules.wavenative.player

import android.content.Context
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.exoplayer.audio.DefaultAudioSink

/**
 * The audio pipeline's hook for custom processing: equalizer, crossfade and
 * ReplayGain (v2) become [audioProcessors] without restructuring the player.
 */
@UnstableApi
class WaveRenderersFactory(
  context: Context,
  private val audioProcessors: List<AudioProcessor> = emptyList(),
) : DefaultRenderersFactory(context) {
  override fun buildAudioSink(
    context: Context,
    enableFloatOutput: Boolean,
    enableAudioTrackPlaybackParams: Boolean,
  ): AudioSink =
    DefaultAudioSink.Builder(context)
      .setEnableFloatOutput(enableFloatOutput)
      .setEnableAudioTrackPlaybackParams(enableAudioTrackPlaybackParams)
      .setAudioProcessors(audioProcessors.toTypedArray())
      .build()
}
