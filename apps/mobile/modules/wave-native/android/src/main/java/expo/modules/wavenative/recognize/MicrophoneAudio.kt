package expo.modules.wavenative.recognize

import android.annotation.SuppressLint
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder

/**
 * The microphone at 16 kHz mono, the rate Shazam's signature takes (Android's CDD
 * requires every phone to capture at it, so nothing is resampled). It records from
 * the voice recognition source, which the CDD asks to have no noise suppression and
 * no automatic gain, with a flat response: the music's peaks reach the signature as
 * they sound. The caller checks RECORD_AUDIO first.
 */
class MicrophoneAudio private constructor(private val record: AudioRecord) : RecognizeAudio {
  @Volatile private var stopped = false

  override fun read(buffer: ShortArray): Int {
    if (stopped) return -1
    val count = record.read(buffer, 0, buffer.size)
    // After stop() a blocked read comes back empty; an error code means the microphone went.
    return if (stopped || count <= 0) -1 else count
  }

  override fun stop() {
    stopped = true
    runCatching { record.stop() }
  }

  override fun release() = record.release()

  companion object {
    private const val SAMPLE_RATE = 16_000

    /** Starts recording; throws [IllegalStateException] when the microphone can't be opened. */
    @SuppressLint("MissingPermission")
    fun open(): MicrophoneAudio {
      val minimum = AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
      // Half a second of room, so a busy capture thread doesn't lose audio.
      val size = maxOf(minimum, SAMPLE_RATE)
      val record = AudioRecord(
        MediaRecorder.AudioSource.VOICE_RECOGNITION,
        SAMPLE_RATE,
        AudioFormat.CHANNEL_IN_MONO,
        AudioFormat.ENCODING_PCM_16BIT,
        size,
      )
      if (record.state != AudioRecord.STATE_INITIALIZED) {
        record.release()
        throw IllegalStateException("The microphone couldn't be opened")
      }
      record.startRecording()
      if (record.recordingState != AudioRecord.RECORDSTATE_RECORDING) {
        record.release()
        throw IllegalStateException("The microphone didn't start recording")
      }
      return MicrophoneAudio(record)
    }
  }
}
