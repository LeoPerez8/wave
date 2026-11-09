package expo.modules.wavenative.player

import android.content.Context
import android.content.SharedPreferences
import java.util.Locale

/** Where a song's gain came from (Core's `GainSource`), as the app log names it. */
enum class GainSource(val logName: String) {
  TAG("tag"),
  MEASURED("measured"),
  YOUTUBE("YouTube"),
  TYPICAL("typical"),
  OFF("off"),
  ;

  companion object {
    /** The source Core calls [name] (`"tag"`), or null for one this side doesn't know. */
    fun of(name: String?): GainSource? = entries.firstOrNull { it.name.equals(name, ignoreCase = true) }
  }
}

/** The gain a song plays at, in dB (0 plays it as it is), and its source (Core's `SongGain`). */
data class SongGain(val gainDb: Double, val source: GainSource)

/**
 * What Wave knows of a song's loudness (Core's `SongLoudness`): YouTube's
 * `loudnessDb` for a streamed YT Music song, dB above YouTube's -14 LUFS
 * reference ([expo.modules.wavenative.yt.YtLoudness]); and [known], a Library
 * song's gain as Core's `knownGain` worked it out from its tags, which comes
 * with the queue ([SongGains]). Null when there's none.
 */
data class SongLoudness(val youtubeLoudnessDb: Double? = null, val known: SongGain? = null)

/**
 * Normalize Volume (Settings › Playback): whether songs play at their leveled
 * gain. JS sets it ([WavePlayerModule]'s `setNormalizeVolume`); it's kept on
 * disk so the service follows it without JS (a cold start from Auto or the
 * media controls), and read by each player's [GainStage] on the playback
 * thread at every buffer, so a change applies to the song playing at once.
 *
 * [gain] is a copy of Core's `songGain` (the service can't call Core):
 * `NormalizeVolumeTest` runs `normalizeVolume.test.ts`'s cases. Change both together.
 * The typical gain ([typicalDb], Core's `typicalGain` of the Library) is JS's
 * to work out; it's kept on disk too, so a cold start plays at the last one.
 */
object NormalizeVolume {
  private const val PREFS = "wave_normalize_volume"
  private const val ON_KEY = "on"
  private const val TYPICAL_KEY = "typicalDb"

  /** Core's `TYPICAL_GAIN_START_DB`: what a song with no value plays at. */
  const val TYPICAL_START_DB = -5.0

  private var prefs: SharedPreferences? = null

  /** The switch, as the playback thread reads it; on until JS has said otherwise. */
  @Volatile
  var on: Boolean = true
    private set

  /** What a song with no value plays at (Core's `typicalGain`), as JS last gave it. */
  @Volatile
  var typicalDb: Double = TYPICAL_START_DB
    private set

  fun init(context: Context) {
    if (prefs != null) return
    val stored = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    prefs = stored
    on = stored.getBoolean(ON_KEY, true)
    typicalDb = stored.getFloat(TYPICAL_KEY, TYPICAL_START_DB.toFloat()).toDouble()
  }

  fun setOn(on: Boolean) {
    this.on = on
    prefs?.edit()?.putBoolean(ON_KEY, on)?.apply()
  }

  /** The Library's typical gain changed; songs starting from now on with no value play at it. */
  fun setTypical(gainDb: Double) {
    if (!gainDb.isFinite()) return
    typicalDb = gainDb
    prefs?.edit()?.putFloat(TYPICAL_KEY, gainDb.toFloat())?.apply()
  }

  /**
   * The gain [song] plays at, and its source (Core's `songGain`). With the
   * switch off every song plays as it is. A Library song plays at the gain
   * Core gave it with the queue. A streamed song louder than YouTube's
   * reference is turned down by YouTube's value, never turned up, as YouTube
   * gives no peak. A song with no value plays at the typical gain.
   */
  fun gain(on: Boolean, song: SongLoudness, typicalDb: Double = this.typicalDb): SongGain {
    if (!on) return SongGain(0.0, GainSource.OFF)
    song.known?.takeIf { it.gainDb.isFinite() }?.let { return it }
    val youtube = song.youtubeLoudnessDb
    if (youtube != null && youtube.isFinite()) {
      return SongGain(if (youtube > 0) -youtube else 0.0, GainSource.YOUTUBE)
    }
    return SongGain(typicalDb, GainSource.TYPICAL)
  }

  /** The app log line a song's start writes: its gain and the gain's source, never the song. */
  fun logLine(gain: SongGain): String =
    "Song gain ${String.format(Locale.ROOT, "%.1f", gain.gainDb)} dB (${gain.source.logName})"

  const val LOG_TAG = "WaveGain"
}
