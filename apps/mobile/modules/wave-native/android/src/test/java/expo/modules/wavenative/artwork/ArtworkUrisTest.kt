package expo.modules.wavenative.artwork

import expo.modules.wavenative.Fixtures
import java.io.File
import java.util.Base64
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
    assertEquals(
      ArtworkRequest.Mosaic(listOf(a, b, c, d).map(ArtworkTile::Cached)),
      ArtworkUris.parse(authority, uri!!),
    )
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
  fun aMosaicIsMadeOfThumbnails() {
    assertEquals(File("/files/artwork/${a}_thumb.jpg"), ArtworkUris.mosaicTile(File("/files/artwork"), a))
  }

  @Test
  fun anOnlineCoverMapsToAUriAndBackWithItsAddressesInOrder() {
    val addresses = listOf("https://lh3.googleusercontent.com/x=w640-h640", "https://lh3.googleusercontent.com/x=w120-h120")
    val uri = ArtworkUris.forCovers(authority, listOf(addresses))
    assertEquals(ArtworkRequest.Online(addresses), ArtworkUris.parse(authority, uri!!))
  }

  @Test
  fun aMosaicMixesCachedAndOnlineCovers() {
    val online = listOf("https://i.ytimg.com/vi/abc/hqdefault.jpg")
    val uri = ArtworkUris.forCovers(authority, listOf(listOf("/x/${a}_thumb.jpg"), online, listOf("/x/$c.jpg"), listOf("/x/$d.jpg")))
    assertEquals(
      ArtworkRequest.Mosaic(
        listOf(ArtworkTile.Cached(a), ArtworkTile.Online(online), ArtworkTile.Cached(c), ArtworkTile.Cached(d)),
      ),
      ArtworkUris.parse(authority, uri!!),
    )
  }

  @Test
  fun anAddressOfAnotherHostIsNotServed() {
    assertNull(ArtworkUris.forCovers(authority, listOf(listOf("https://example.com/x.jpg"))))
    assertEquals(
      "content://$authority/$b",
      ArtworkUris.forCovers(authority, listOf(listOf("http://10.0.0.1/x.jpg"), listOf("/x/$b.jpg"))),
    )
  }

  @Test
  fun onlyCoverHostsAreServed() {
    assertNull(ArtworkUris.forCovers(authority, listOf(listOf("https://image-cdn-ak.spotifycdn.com/image/x"))))
    val spotify = listOf("https://i.scdn.co/image/ab67616d00001e02abc")
    val uri = ArtworkUris.forCovers(authority, listOf(spotify))
    assertEquals(ArtworkRequest.Online(spotify), ArtworkUris.parse(authority, uri!!))
  }

  @Test
  fun theOldestOnlineCoversGoPastTheCap() {
    val dir = Fixtures.tempDir()
    val (old, middle, new) = listOf(1_000L, 2_000L, 3_000L).mapIndexed { index, modified ->
      File(dir, "$index.img").apply {
        writeBytes(ByteArray(10))
        setLastModified(modified)
      }
    }
    val partial = File(dir, ".partial.img.tmp").apply { writeBytes(ByteArray(10)) }
    ArtworkUris.trimOnlineCovers(dir, new, maxBytes = 20)
    assertEquals(listOf(false, true, true, true), listOf(old, middle, new, partial).map(File::exists))
  }

  @Test
  fun theCoverJustWrittenStaysEvenOverTheCap() {
    val dir = Fixtures.tempDir()
    val cover = File(dir, "a.img").apply { writeBytes(ByteArray(10)) }
    ArtworkUris.trimOnlineCovers(dir, cover, maxBytes = 1)
    assertEquals(true, cover.exists())
  }

  @Test
  fun aForgedOnlineUriIsRejected() {
    val forged = Base64.getUrlEncoder().withoutPadding().encodeToString("https://example.com/x.jpg".toByteArray())
    assertNull(ArtworkUris.parse(authority, "content://$authority/o.$forged"))
    assertNull(ArtworkUris.parse(authority, "content://$authority/o."))
    assertNull(ArtworkUris.parse(authority, "content://$authority/o.%%%"))
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
