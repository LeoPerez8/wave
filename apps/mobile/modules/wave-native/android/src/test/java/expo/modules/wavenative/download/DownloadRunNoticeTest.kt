package expo.modules.wavenative.download

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** The run JS pushes for the download notification (Core's `downloadRunNotice`, #476). */
class DownloadRunNoticeTest {
  @Test fun readsTheRunJsPushed() {
    assertEquals(
      DownloadRunNotice(title = "Downloading 1,234 of 2,500", text = "12 failed · 1,254 left · About 2 h left", finished = 1246, total = 2500),
      DownloadRunNotice.of(mapOf("title" to "Downloading 1,234 of 2,500", "text" to "12 failed · 1,254 left · About 2 h left", "finished" to 1246.0, "total" to 2500.0)),
    )
  }

  @Test fun noRunWhenJsSaysNoneOrSendsSomethingElse() {
    assertNull(DownloadRunNotice.of(null))
    assertNull(DownloadRunNotice.of(mapOf("title" to "Downloading 1 of 2")))
    assertNull(DownloadRunNotice.of(mapOf("title" to "Downloading 0 of 1", "text" to "1 left", "finished" to 0.0, "total" to 1.0)))
  }
}
