package expo.modules.wavenative.normalize

import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.PI
import kotlin.math.sin
import kotlin.math.pow
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AudioLoudnessMeterTest {
  @Test
  fun aOneKilohertzStereoSineAtMinus23LufsMeasuresMinus23LufsAndItsPeak() {
    val rate = 48_000
    val seconds = 10
    val peak = (10.0.pow(-23.0 / 20.0) * kotlin.math.sqrt(2.0))
    val pcm = ByteBuffer.allocate(seconds * rate * 2 * 2).order(ByteOrder.LITTLE_ENDIAN)
    for (frame in 0 until seconds * rate) {
      val sample = (sin(2 * PI * 1_000 * frame / rate) * peak * Short.MAX_VALUE).toInt().toShort()
      pcm.putShort(sample).putShort(sample)
    }
    pcm.flip()
    val meter = AudioLoudnessMeter.Bs1770(rate, 2)
    meter.consume(pcm, 0, pcm.remaining(), android.media.AudioFormat.ENCODING_PCM_16BIT)
    val result = meter.result()
    assertEquals(-23.0, result.integratedLufs, 0.1)
    assertTrue(kotlin.math.abs(result.samplePeak - peak) < 0.0001)
  }
}
