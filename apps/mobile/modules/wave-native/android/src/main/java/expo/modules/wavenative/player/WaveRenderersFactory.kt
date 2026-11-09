package expo.modules.wavenative.player

import android.content.Context
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.exoplayer.audio.DefaultAudioSink

/**
 * The audio pipeline's hook for custom processing: Normalize Volume's
 * [GainStage] is one of [audioProcessors], and an equalizer (v2) would join it
 * without restructuring the player. Each player gets its own processors.
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
