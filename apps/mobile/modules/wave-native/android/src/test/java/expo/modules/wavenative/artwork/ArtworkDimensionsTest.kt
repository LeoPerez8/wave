package expo.modules.wavenative.artwork

import org.junit.Assert.assertEquals
import org.junit.Test

class ArtworkDimensionsTest {
  @Test fun mediumKeepsAspectRatioAndCapsTheLongSide() {
    assertEquals(640 to 320, ArtworkDimensions.fit(3000, 1500, 640))
    assertEquals(320 to 640, ArtworkDimensions.fit(1500, 3000, 640))
    assertEquals(640 to 640, ArtworkDimensions.fit(1400, 1400, 640))
    assertEquals(640 to 1, ArtworkDimensions.fit(3000, 1, 640))
  }

  @Test fun smallCoversAreNeverUpscaled() {
    assertEquals(240 to 180, ArtworkDimensions.fit(240, 180, 640))
    assertEquals(1 to 1, ArtworkDimensions.fit(1, 1, 640))
  }

  @Test fun decodingSamplesForTheLongSideEvenForVeryWideCovers() {
    assertEquals(4, ArtworkDimensions.sampleSize(3000, 1500, 640))
    assertEquals(4, ArtworkDimensions.sampleSize(1, 3000, 640))
    assertEquals(1, ArtworkDimensions.sampleSize(240, 180, 640))
  }
}
