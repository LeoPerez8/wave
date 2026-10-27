package expo.modules.wavenative.artwork

import expo.modules.wavenative.Fixtures
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ArtworkUrisTest {
  private val authority = "dev.leoperez.wave.artwork"
  private val a = "0123456789abcdef0123456789abcdef01234567"
  private val b = "1111111111111111111111111111111111111111"
  private val c = "2222222222222222222222222222222222222222"
  private val d = "3333333333333333333333333333333333333333"

  @Test
  fun theAuthorityIsTheAppsOwn() {
    assertEquals(authority, ArtworkUris.authority("dev.leoperez.wave"))
  }

  @Test
  fun aCoverHashMapsToAContentUriAndBack() {
    val uri = ArtworkUris.uri(authority, listOf(a))
    assertEquals("content://$authority/$a", uri)
    assertEquals(ArtworkRequest.Cover(a), ArtworkUris.parse(authority, uri!!))
  }

  @Test
  fun fourHashesMapToAMosaicAndBack() {
    val uri = ArtworkUris.uri(authority, listOf(a, b, c, d))
    assertEquals("content://$authority/mosaic/$a/$b/$c/$d", uri)
    assertEquals(ArtworkRequest.Mosaic(listOf(a, b, c, d)), ArtworkUris.parse(authority, uri!!))
  }

  @Test
  fun fewerThanFourHashesShowTheFirstCover() {
    assertEquals("content://$authority/$b", ArtworkUris.uri(authority, listOf(b, c)))
  }

  @Test
  fun noHashMeansNoUri() {
    assertNull(ArtworkUris.uri(authority, emptyList()))
  }

  @Test
  fun cachedFilesMapToTheirHash() {
    assertEquals(a, ArtworkUris.hashOf("/data/user/0/dev.leoperez.wave/files/artwork/$a.jpg"))
    assertEquals(a, ArtworkUris.hashOf("/data/files/artwork/$a.webp"))
    assertEquals(a, ArtworkUris.hashOf("/data/files/artwork/${a}_thumb.jpg"))
    assertEquals(a, ArtworkUris.hashOf("$a.img"))
  }

  @Test
  fun filesThatArentCachedArtworkHaveNoHash() {
    assertNull(ArtworkUris.hashOf("/music/cover.jpg"))
    assertNull(ArtworkUris.hashOf("/data/files/artwork/$a.palette"))
    assertNull(ArtworkUris.hashOf("/data/files/artwork/${a.uppercase()}.jpg"))
    assertNull(ArtworkUris.hashOf("/data/files/artwork/${a.dropLast(1)}.jpg"))
    assertNull(ArtworkUris.hashOf(""))
  }

  @Test
  fun filesMapToAUriSkippingUnknownOnes() {
    val files = listOf("/x/$a.jpg", "/x/${b}_thumb.jpg", "/x/$c.png", "/x/$d.gif")
    assertEquals("content://$authority/mosaic/$a/$b/$c/$d", ArtworkUris.forFiles(authority, files))
    assertEquals("content://$authority/$b", ArtworkUris.forFiles(authority, listOf("/music/x.jpg", "/x/$b.jpg")))
    assertNull(ArtworkUris.forFiles(authority, listOf("/music/x.jpg")))
    assertNull(ArtworkUris.forFiles(authority, emptyList()))
  }

  @Test
  fun unknownOrMalformedUrisAreRejected() {
    val rejected = listOf(
      "",
      "content://$authority",
      "content://$authority/",
      "file:///data/files/artwork/$a.jpg",
      "content://other.app.artwork/$a",
      "content://$authority/${a.uppercase()}",
      "content://$authority/${a.dropLast(1)}",
      "content://$authority/${a}0",
      "content://$authority/$a.jpg",
      "content://$authority/$a/thumb",
      "content://$authority/../$a",
      "content://$authority/%2E%2E/$a",
      "content://$authority/$a?x=1",
      "content://$authority/$a#x",
      "content://$authority//$a",
      "content://$authority/mosaic",
      "content://$authority/mosaic/$a/$b/$c",
      "content://$authority/mosaic/$a/$b/$c/$d/$a",
      "content://$authority/mosaic/$a/$b/$c/../$d",
      "content://$authority/unknown/$a",
    )
    for (uri in rejected) assertNull(uri, ArtworkUris.parse(authority, uri))
  }

  @Test
  fun aCoverIsTheOriginalImageWhateverItsFormat() {
    val dir = Fixtures.tempDir()
    File(dir, "${a}_thumb.jpg").writeBytes(byteArrayOf(1))
    File(dir, "$a.palette").writeText("dominant=#ff000000")
    File(dir, "$a.png").writeBytes(byteArrayOf(2))
    assertEquals(File(dir, "$a.png"), ArtworkUris.coverFile(dir, a))
  }

  @Test
  fun aPlaylistsOwnImageIsServedAsACover() {
    val dir = Fixtures.tempDir()
    val playlists = File(dir, "playlists").apply { mkdirs() }
    File(playlists, "${a}_thumb.jpg").writeBytes(byteArrayOf(1))
    File(playlists, "$a.jpg").writeBytes(byteArrayOf(2))
    val uri = ArtworkUris.forFiles(authority, listOf("${playlists.path}/${a}_thumb.jpg"))
    assertEquals(ArtworkRequest.Cover(a), ArtworkUris.parse(authority, uri!!))
    assertEquals(File(playlists, "$a.jpg"), ArtworkUris.coverFile(dir, a))
  }

  @Test
  fun aMissingCoverHasNoFile() {
    val dir = Fixtures.tempDir()
    File(dir, "${a}_thumb.jpg").writeBytes(byteArrayOf(1))
    assertNull(ArtworkUris.coverFile(dir, a))
    assertNull(ArtworkUris.coverFile(dir, "../$a"))
  }

  @Test
  fun aMosaicIsMadeOfTheFourThumbnails() {
    val dir = File("/files/artwork")
    assertEquals(
      listOf(a, b, c, d).map { File(dir, "${it}_thumb.jpg") },
      ArtworkUris.mosaicTiles(dir, listOf(a, b, c, d)),
    )
  }
  @Test
  fun mediumCoversFallBackToOriginalsUntilTheBackfillArrives() {
    val dir = Fixtures.tempDir()
    val original = File(dir, "$a.png").apply { writeBytes(byteArrayOf(1)) }
    val uri = "content://$authority/medium/$a"
    assertEquals(ArtworkRequest.Medium(a), ArtworkUris.parse(authority, uri))
    assertEquals(original, ArtworkUris.mediumFile(dir, a))
    val medium = File(dir, "${a}_medium.jpg").apply { writeBytes(byteArrayOf(2)) }
    assertEquals(medium, ArtworkUris.mediumFile(dir, a))
    assertEquals(original, ArtworkUris.coverFile(dir, a))
    assertNull(ArtworkUris.mediumFile(dir, "../$a"))
    assertNull(ArtworkUris.parse(authority, "content://$authority/medium/../$a"))
  }

  @Test
  fun rowsUseThumbnailThenMediumThenOriginal() {
    val dir = Fixtures.tempDir()
    val original = File(dir, "$a.png").apply { writeBytes(byteArrayOf(1)) }
    assertEquals(original, ArtworkUris.thumbnailFile(dir, a))
    val medium = File(dir, "${a}_medium.jpg").apply { writeBytes(byteArrayOf(2)) }
    assertEquals(medium, ArtworkUris.thumbnailFile(dir, a))
    val thumb = File(dir, "${a}_thumb.jpg").apply { writeBytes(byteArrayOf(3)) }
    assertEquals(thumb, ArtworkUris.thumbnailFile(dir, a))
    assertEquals(ArtworkRequest.Thumbnail(a), ArtworkUris.parse(authority, "content://$authority/thumbnail/$a"))
  }

}
