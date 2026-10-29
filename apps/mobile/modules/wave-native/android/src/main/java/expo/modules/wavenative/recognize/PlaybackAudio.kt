package expo.modules.wavenative.recognize

import android.annotation.SuppressLint
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioPlaybackCaptureConfiguration
import android.media.AudioRecord
import android.media.projection.MediaProjection
import android.os.Handler
import android.os.Looper
import android.os.Process
import java.util.concurrent.atomic.AtomicBoolean

/** Phone audio only. Wave never enters this recording, even when it keeps playing. */
class PlaybackAudio private constructor(
  private val record: AudioRecord,
  private val projection: MediaProjection,
  private val onReleased: () -> Unit,
) : RecognizeAudio {
  private val stopped = AtomicBoolean(false)
  private val released = AtomicBoolean(false)
  private val callback = object : MediaProjection.Callback() {
    override fun onStop() = stop()
  }

  init {
    projection.registerCallback(callback, Handler(Looper.getMainLooper()))
  }

  override fun read(buffer: ShortArray): Int {
    if (stopped.get()) return -1
    val count = record.read(buffer, 0, buffer.size)
    return if (stopped.get() || count <= 0) -1 else count
  }

  override fun stop() {
    if (!stopped.compareAndSet(false, true)) return
    runCatching { record.stop() }
    runCatching { projection.stop() }
  }

  override fun release() {
    if (!released.compareAndSet(false, true)) return
    try {
      stop()
      runCatching { projection.unregisterCallback(callback) }
      record.release()
    } finally {
      onReleased()
    }
  }

  companion object {
    private const val SAMPLE_RATE = 16_000

    @SuppressLint("MissingPermission")
    fun open(projection: MediaProjection, onReleased: () -> Unit): PlaybackAudio {
      val capture = AudioPlaybackCaptureConfiguration.Builder(projection)
        .addMatchingUsage(AudioAttributes.USAGE_MEDIA)
        .addMatchingUsage(AudioAttributes.USAGE_GAME)
        .addMatchingUsage(AudioAttributes.USAGE_UNKNOWN)
        .excludeUid(Process.myUid())
        .build()
      val format = AudioFormat.Builder()
        .setSampleRate(SAMPLE_RATE)
        .setChannelMask(AudioFormat.CHANNEL_IN_MONO)
        .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
        .build()
      val minimum = AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
      val record = AudioRecord.Builder()
        .setAudioFormat(format)
        .setBufferSizeInBytes(maxOf(minimum, SAMPLE_RATE))
        .setAudioPlaybackCaptureConfig(capture)
        .build()
      val audio = PlaybackAudio(record, projection, onReleased)
      try {
        check(record.state == AudioRecord.STATE_INITIALIZED) { "Phone audio couldn't be opened" }
        record.startRecording()
        check(record.recordingState == AudioRecord.RECORDSTATE_RECORDING) { "Phone audio didn't start" }
        return audio
      } catch (e: Exception) {
        audio.release()
        throw e
      }
    }
  }
}
