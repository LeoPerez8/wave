package expo.modules.wavenative.yt

import com.metrolist.innertubex.InnerTubeHttpException
import com.metrolist.innertubex.models.Context as YtContext
import com.metrolist.innertubex.models.YouTubeClient
import io.ktor.client.request.headers
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.content.TextContent
import java.io.IOException
import java.security.MessageDigest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonObjectBuilder
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put

/**
 * One change to a playlist the account made, in Wave's terms ([YtPlaylistWrites.edit]
 * turns each into YouTube Music's `browse/edit_playlist` action).
 */
sealed interface YtPlaylistEdit {
  /** Adds the song [videoId] at the end. */
  data class Add(val videoId: String) : YtPlaylistEdit

  /** Takes out the entry [setVideoId], which holds the song [videoId]. */
  data class Remove(val videoId: String, val setVideoId: String) : YtPlaylistEdit

  /** Moves the entry [setVideoId] right before the entry [before], or to the end for null. */
  data class Move(val setVideoId: String, val before: String?) : YtPlaylistEdit

  /** Renames the playlist. */
  data class Rename(val title: String) : YtPlaylistEdit

  companion object {
    /** The edit JS describes as [map] (`{ kind, … }`); null for one Wave doesn't know. */
    fun of(map: Map<String, Any?>): YtPlaylistEdit? {
      fun text(key: String) = map[key] as? String
      return when (map["kind"]) {
        "add" -> text("videoId")?.let(::Add)
        "remove" -> {
          val videoId = text("videoId") ?: return null
          Remove(videoId, text("setVideoId") ?: return null)
        }
        "move" -> text("setVideoId")?.let { Move(it, text("before")) }
        "rename" -> text("title")?.let(::Rename)
        else -> null
      }
    }

    /** [edit] as a YouTube Music `browse/edit_playlist` action (as ytmusicapi's `edit_playlist` and `add_playlist_items` send it, MIT). */
    fun action(edit: YtPlaylistEdit): JsonObject = buildJsonObject {
      when (edit) {
        is Add -> {
          put("action", "ACTION_ADD_VIDEO")
          put("addedVideoId", edit.videoId)
          put("dedupeOption", "DEDUPE_OPTION_SKIP")
        }
        is Remove -> {
          put("action", "ACTION_REMOVE_VIDEO")
          put("setVideoId", edit.setVideoId)
          put("removedVideoId", edit.videoId)
        }
        is Move -> {
          put("action", "ACTION_MOVE_VIDEO_BEFORE")
          put("setVideoId", edit.setVideoId)
          edit.before?.let { put("movedSetVideoIdSuccessor", it) }
        }
        is Rename -> {
          put("action", "ACTION_SET_PLAYLIST_NAME")
          put("playlistName", edit.title)
        }
      }
    }
  }
}

/**
 * Making and editing playlists on the signed-in account, for sharing a
 * Wave playlist on YT Music. innertubex's own `createPlaylist` always makes a
 * private one and adds songs one request each, so these requests are sent
 * here, as innertubex sends its own (the same headers, the account's
 * `SAPISIDHASH`): `playlist/create` with the songs and `UNLISTED`, and
 * `browse/edit_playlist` with many actions at once. Reading a playlist back
 * goes through innertubex's `browse`. Every call needs the session: signed
 * out, or with one YouTube refuses, it fails with [YtFailure.SIGNED_OUT].
 */
class YtPlaylistWrites(private val client: YtClient) {
  private val json = Json { ignoreUnknownKeys = true; explicitNulls = false; encodeDefaults = true }

  /**
   * The entries of the account's playlist [playlistId], every page; null
   * when there's no such playlist any more (deleted on YouTube Music) or it
   * isn't the account's to edit.
   */
  suspend fun ownPlaylist(playlistId: String): List<YtOwnEntry>? = client.request {
    signedIn()
    val first = try {
      val response = client.innerTube.browse(YouTubeClient.WEB_REMIX, "VL$playlistId")
      if (response.status.value in GONE) return@request null
      YtOwnPlaylistParser.page(response.bodyAsText())
    } catch (e: InnerTubeHttpException) {
      if (e.status.value in GONE) return@request null
      throw e
    } ?: return@request null
    if (!first.editable) return@request null
    val entries = first.entries.toMutableList()
    var token = first.continuation
    while (token != null) {
      val body = client.innerTube.browse(YouTubeClient.WEB_REMIX, continuation = token).bodyAsText()
      val page = YtOwnPlaylistParser.more(body) ?: throw IOException("Not a playlist continuation")
      entries += page.entries
      token = page.continuation
    }
    entries
  }

  /** Makes an unlisted playlist [title] holding [videoIds], in order, and returns its id. */
  suspend fun create(title: String, videoIds: List<String>): String = client.request {
    val answer = send("playlist/create") {
      put("title", title)
      put("privacyStatus", "UNLISTED")
      put("videoIds", JsonArray(videoIds.map(::JsonPrimitive)))
    }
    (answer["playlistId"] as? JsonPrimitive)?.contentOrNull
      ?: throw IOException("No playlist id in YouTube Music's answer")
  }

  /** Applies [edits] to the account's playlist [playlistId], in order, in one request. */
  suspend fun edit(playlistId: String, edits: List<YtPlaylistEdit>) {
    if (edits.isEmpty()) return
    client.request {
      val answer = send("browse/edit_playlist") {
        put("playlistId", playlistId)
        put("actions", JsonArray(edits.map(YtPlaylistEdit::action)))
      }
      val status = (answer["status"] as? JsonPrimitive)?.contentOrNull
      if (status != null && status != "STATUS_SUCCEEDED") throw IOException("Playlist edit $status")
    }
  }

  private fun signedIn(): YtCredentials =
    (client.session.state as? YtSessionState.SignedIn)?.credentials
      ?: throw YtException(YtFailure.SIGNED_OUT)

  /**
   * Posts YouTube Music's endpoint [endpoint] as the account, with the
   * request's [fields] beside the client context, and returns its answer.
   */
  private suspend fun send(
    endpoint: String,
    fields: JsonObjectBuilder.() -> Unit,
  ): JsonObject {
    val credentials = signedIn()
    val tube = client.innerTube
    val web = YouTubeClient.WEB_REMIX
    val context = web.toContext(tube.locale, tube.visitorData, credentials.dataSyncId)
    val body = buildJsonObject {
      put("context", json.encodeToJsonElement(YtContext.serializer(), context))
      fields()
    }
    val sapisid = sapisid(credentials.cookie) ?: throw YtException(YtFailure.SIGNED_OUT)
    val response = client.http.post("$ORIGIN/youtubei/v1/$endpoint?prettyPrint=false") {
      headers {
        append("Cookie", credentials.cookie)
        append("Authorization", sapisidHash(sapisid, System.currentTimeMillis() / 1000))
        append("X-Goog-AuthUser", credentials.authUser)
        append("X-Goog-Api-Format-Version", "1")
        append("X-YouTube-Client-Name", web.clientId)
        append("X-YouTube-Client-Version", web.clientVersion)
        append("X-Origin", ORIGIN)
        append("Origin", ORIGIN)
        append("Referer", "$ORIGIN/")
        append("User-Agent", web.userAgent)
        tube.visitorData?.let { append("X-Goog-Visitor-Id", it) }
      }
      setBody(TextContent(body.toString(), ContentType.Application.Json))
    }
    val status = response.status.value
    if (status == 401) {
      client.session.checked(credentials, YtAccountMenu.SignedOut)
      throw YtException(YtFailure.SIGNED_OUT)
    }
    if (status !in 200..299) throw IOException("YouTube Music answered $status to $endpoint")
    return json.parseToJsonElement(response.bodyAsText()).jsonObject
  }

  companion object {
    private const val ORIGIN = "https://music.youtube.com"

    /** What browsing a playlist that's gone answers. */
    private val GONE = setOf(400, 403, 404)

    /** The session's `SAPISID` (or its secure twin) from the `Cookie` header [cookie]. */
    fun sapisid(cookie: String): String? {
      val values = cookie.split(";").mapNotNull {
        val pair = it.trim().split("=", limit = 2)
        if (pair.size == 2) pair[0] to pair[1] else null
      }.toMap()
      return values["SAPISID"] ?: values["__Secure-3PAPISID"]
    }

    /** The `Authorization` header YouTube asks of a signed-in web client at [seconds]. */
    fun sapisidHash(sapisid: String, seconds: Long): String {
      val digest = MessageDigest.getInstance("SHA-1").digest("$seconds $sapisid $ORIGIN".toByteArray())
      return "SAPISIDHASH ${seconds}_${digest.joinToString("") { "%02x".format(it) }}"
    }
  }
}
