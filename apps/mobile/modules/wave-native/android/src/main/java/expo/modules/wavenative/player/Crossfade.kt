package expo.modules.wavenative.player

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

/** A player as [Crossfade] drives it. */
interface CrossfadeDeck {
  val positionMs: Long
  val isPlaying: Boolean

  /** Whether it played its song to the end. */
  val ended: Boolean

  fun setVolume(volume: Float)

  fun setSpeed(speed: Float)

  fun seekTo(positionMs: Long)

  fun setPlaying(playing: Boolean)
}

/** What [Crossfade] needs from [PlaybackService]. */
interface CrossfadeHost {
  /** The session's player: the queue, the notification, Auto. */
  val main: CrossfadeDeck

  /** The current song's length, or null while it isn't known. */
  val mainDurationMs: Long?

  /** Whether the session's player is to play: play pressed, and nothing (a call) holding it back. */
  val mainWantsToPlay: Boolean

  /**
   * Whether the current song, ending on its own, moves on to another one: there
   * is a next song, repeat one isn't on, and no end-of-song sleep timer waits for it.
   */
  val movesOnNaturally: Boolean

  /** Whether the session's player has the next song's start buffered, ready to sound. */
  val nextReady: Boolean

  /** The entry the session's player is on (its media id), or null. */
  val currentKey: String?

  /** The entry it moves to when the current song ends on its own, or null. */
  val nextKey: String?

  /** Real time (elapsed-realtime ms), which bounds an overlap whatever the players' positions say. */
  val nowMs: Long

  /**
   * Starts making the next song ready: a streamed song's address resolved and
   * its start buffered. Asked once per song, at [CrossfadeTiming.prefetchAt].
   */
  fun prefetchNext()

  /** Whether the next song is an unsearched one JS is still searching (Core's `searchingAfter`). */
  val nextSearching: Boolean

  /** What crossfade did at a song change, once per change. For the app log. */
  fun outcome(outcome: CrossfadeOutcome)

  /** Opens a second player on the current song at [positionMs], playing. */
  fun openTail(positionMs: Long): CrossfadeDeck

  fun closeTail()

  /** Moves the session's player to the next song, from its start. */
  fun advance()

  /** The song fading out went silent or was cut off. */
  fun fadeEnded()
}

/** Why a song change had no overlap, or an overlap was cut, as the app log says it. */
interface CrossfadeReason {
  val reason: String
}

/** What crossfade did at one song change: the app log gets exactly one per change. */
sealed interface CrossfadeOutcome {
  /** No overlap, for [why]; [lateMs] is how late the next song was, when that was why. */
  data class Skipped(val why: CrossfadeReason, val lateMs: Long = 0) : CrossfadeOutcome

  /** The overlap ran to its end over [overlapMs], [lateMs] shorter than the song's whole one. */
  data class Done(val overlapMs: Long, val lateMs: Long) : CrossfadeOutcome

  /**
   * The overlap was cut for [why], [elapsedMs] into it (real time, from when the incoming song
   * sounded, or from the move while it hadn't: [overlapMs] null).
   */
  data class Cut(val why: CrossfadeEnd, val elapsedMs: Long, val overlapMs: Long?) : CrossfadeOutcome
}

/** The rules that leave a song change without an overlap, besides a pre-roll called off ([CrossfadeEnd]). */
enum class CrossfadeSkip(override val reason: String) : CrossfadeReason {
  Off("crossfade is off"),
  NotPlaying("the song wasn't playing"),
  UnknownLength("the song's length wasn't known"),
  PastHandoff("the song was already past the handoff point"),
  NoNext("no song plays next on its own"),
  NotReady("the next song wasn't ready"),
  Searching("the next song was still being searched"),
  Early("the song changed before its overlap was due"),
}

/** Why a pre-roll or an overlap ended before its time, as the app log says it. */
enum class CrossfadeEnd(override val reason: String) : CrossfadeReason {
  /** A skip, previous, picking a song, or the song being faded into replaced in the queue. */
  Moved("the player moved to another song"),
  Seek("a seek"),
  Error("a player error"),
  Paused("playback paused"),
  Off("crossfade turned off"),
  NoNext("no song plays next on its own"),
  NotInStep("the outgoing song couldn't get in step"),
  Stalled("the outgoing song stalled"),
  Stopped("the playback service stopped"),
  Overdue("the overlap outlasted its length"),
}

/**
 * Crossfade (Settings › Playback): a song ending on its own overlaps the next
 * one for [overlapMs], the first fading out while the next fades in.
 *
 * The session's player plays the queue as always; a second player (the tail)
 * plays only the outgoing song's last seconds. Shortly before the overlap the
 * tail opens on the same song, silent, and is brought in step with the
 * session's player (playback speed while it's off by a little, a seek while
 * it's off by a lot). At the overlap the tail takes over the outgoing song at
 * full volume and the session's player moves to the next song, so Now Playing,
 * the notification, the lock screen and Auto show it from then on. A tail
 * still out of step when the overlap is due is late, as a late next song is
 * (below); one that never gets in step leaves that song gapless.
 *
 * The next song is made ready well ahead ([CrossfadeHost.prefetchNext] at
 * [CrossfadeTiming.prefetchAt]). One still not ready when the overlap should
 * begin is late: the outgoing song plays on at full volume, and the overlap
 * starts once it's ready, over the time left ([CrossfadeTiming.lateOverlap]),
 * or the song ends gapless. That holds both before the move
 * ([CrossfadeHost.nextReady], [overlapOnceReady]) and after it, while the
 * session's player buffers the next song's start: the overlap's clock only
 * starts once the incoming song sounds. The outgoing song never fades out alone.
 *
 * Once begun, the overlap runs to its end unless the song being faded into
 * changes ([moved]: a skip, previous, picking a song, the next song replaced
 * in the queue), the owner seeks, or the player fails ([interrupt]): those
 * switch at once. A queue sync that leaves the next song as it was doesn't.
 * Pausing pauses the tail too. The overlap is bounded by real time as well
 * as by the players' positions: once it has run (paused time aside) its
 * length plus [OVERDUE_MS] since the incoming song sounded, it ends, whatever
 * the session's player's position says.
 *
 * Every song change gets exactly one outcome in the app log
 * ([CrossfadeHost.outcome]): skipped with the rule that skipped it, done with
 * the overlap it had, or cut with why and how long it ran.
 *
 * Main thread only. [tick] runs the timing; the service calls it again after
 * the delay it returns. The fades follow the two songs' positions, which go
 * on with elapsed time, so a tick that comes late (a stall on the main thread)
 * brings the volumes to where they should be by then.
 */
class Crossfade(private val host: CrossfadeHost) {
  /** The overlap chosen in Settings (Core's `crossfadeDuration`); 0 is off. */
  var overlapMs = 0L

  private sealed interface Phase

  private data object Idle : Phase

  /**
   * The tail is open on the outgoing song (of [durationMs]) and getting in
   * step; the overlap is to begin at [handoffAtMs].
   */
  private class PreRoll(
    val tail: CrossfadeDeck,
    val outgoingKey: String?,
    val durationMs: Long,
    val handoffAtMs: Long,
    val overlapMs: Long,
  ) : Phase

  /**
   * The overlap: the tail fades out until the outgoing song's end at [endMs]
   * while the session's player fades in. Its length is fixed once the
   * incoming song sounds ([overlapMs]; null until then), at most [upToMs];
   * [fullMs] is the song's whole overlap, before any was lost to lateness.
   */
  private class Fading(
    var tail: CrossfadeDeck?,
    val incomingKey: String?,
    val endMs: Long,
    val upToMs: Long,
    val fullMs: Long,
    /** How much of the outgoing song was left at the move: the longest it can sound on its own. */
    val leftMs: Long,
    startedAtMs: Long,
    playing: Boolean,
  ) : Phase {
    var overlapMs: Long? = null

    /** Real time the overlap has run since the move, paused time left out. */
    var runMs = 0L

    /** [runMs] when the incoming song began to sound, fixing [overlapMs]. */
    var soundedAtRunMs = 0L

    private var lastMs = startedAtMs
    private var lastPlaying = playing

    /** Adds the real time since the last step, if playback was meant to run through it. */
    fun step(nowMs: Long, playing: Boolean) {
      if (lastPlaying) runMs += (nowMs - lastMs).coerceAtLeast(0L)
      lastMs = nowMs
      lastPlaying = playing
    }

    /** Whether the overlap ran longer in real time than it can, plus [graceMs]. */
    fun outlasted(graceMs: Long): Boolean {
      val overlap = overlapMs
      return if (overlap == null) runMs >= leftMs + graceMs else runMs - soundedAtRunMs >= overlap + graceMs
    }
  }

  private var phase: Phase = Idle

  /** Whether the next song was asked for ([CrossfadeHost.prefetchNext]) while this one plays. */
  private var prefetched = false

  /** Why this song wouldn't overlap the next as things stand ([idle]'s rules); null while it's not due yet. */
  private var skipState: CrossfadeReason? = null

  /** Why this song's overlap was given up (a pre-roll called off, a late next song), and how late. */
  private var skipEvent: CrossfadeReason? = null
  private var skipLateMs = 0L

  /** Whether the overlap under way still owes its song change's outcome. */
  private var owed = false

  /** Brings volumes and timing up to date; returns when to call again, or null to wait for playback. */
  fun tick(): Long? =
    when (val current = phase) {
      Idle -> idle()
      is PreRoll -> preRoll(current)
      is Fading -> fading(current)
    }

  /** The entry the session's player last moved to ([moved]). */
  private var movedTo: String? = null

  /**
   * The session's player moved to the entry [key], for any reason. The move
   * into the song being faded into (the overlap's own, or a queue sync
   * reporting it again) keeps the overlap going; any other ends it at once
   * ([interrupt]): a skip, picking a song, or the next song replaced. A
   * queue sync reporting the song that plays again changes nothing (its next
   * song stays asked for). [restarted]: the same entry again from its start
   * (repeat). Returns whether the song changed, so the service only then
   * turns the next song's preload off again.
   */
  fun moved(key: String?, restarted: Boolean = false): Boolean {
    val changed = key == null || key != movedTo || restarted
    val from = movedTo
    movedTo = key
    val expected = when (val current = phase) {
      Idle -> null
      is PreRoll -> current.outgoingKey
      is Fading -> current.incomingKey
    }
    val own = phase is Fading && key != null && key == expected
    if (phase == Idle) {
      if (changed) interrupt(CrossfadeEnd.Moved)
    } else if (key == null || key != expected) interrupt(CrossfadeEnd.Moved)
    // The overlap's own move reports its outcome once the overlap ends.
    if (changed && !own && from != null && key != null) {
      val why = if (overlapMs <= 0) CrossfadeSkip.Off else skipEvent ?: skipState ?: CrossfadeSkip.Early
      host.outcome(CrossfadeOutcome.Skipped(why, if (why == skipEvent) skipLateMs else 0L))
    }
    if (changed) forgetSkip()
    return changed
  }

  private fun forgetSkip() {
    skipState = null
    skipEvent = null
    skipLateMs = 0L
  }

  private fun giveUp(why: CrossfadeReason, lateMs: Long = 0L) {
    skipEvent = why
    skipLateMs = lateMs
  }

  /** The owner moved the session's player ([why]): no fade, the outgoing song stops now. */
  fun interrupt(why: CrossfadeEnd) {
    prefetched = false
    when (val current = phase) {
      Idle -> {}
      is PreRoll -> {
        giveUp(why)
        host.closeTail()
      }
      is Fading -> {
        current.step(host.nowMs, host.mainWantsToPlay)
        if (current.tail != null) cut(current, why)
        endTail(current)
        host.main.setVolume(1f)
      }
    }
    phase = Idle
  }

  /** Play or pause on the session's player; the outgoing song follows. */
  fun onPlayingChanged() {
    when (val current = phase) {
      is PreRoll -> if (!host.mainWantsToPlay) callOff(CrossfadeEnd.Paused)
      is Fading -> {
        current.step(host.nowMs, host.mainWantsToPlay)
        current.tail?.setPlaying(host.mainWantsToPlay)
      }
      Idle -> {}
    }
  }

  private fun idle(): Long? {
    if (overlapMs <= 0) return skip(CrossfadeSkip.Off, null)
    if (!host.main.isPlaying) return skip(CrossfadeSkip.NotPlaying, null)
    val durationMs = host.mainDurationMs ?: return skip(CrossfadeSkip.UnknownLength, POLL_MS)
    val overlap = min(overlapMs, durationMs / 2)
    val handoffAt = durationMs - overlap
    val positionMs = host.main.positionMs
    val prefetchAt = CrossfadeTiming.prefetchAt(overlapMs, durationMs)
    if (!prefetched && positionMs >= prefetchAt && host.movesOnNaturally) {
      prefetched = true
      host.prefetchNext()
    }
    val openAt = handoffAt - CrossfadeTiming.PREROLL_MS
    skipState = null
    if (positionMs < openAt) {
      val nextAt = if (positionMs < prefetchAt) prefetchAt else openAt
      return (nextAt - positionMs).coerceIn(TICK_MS, POLL_MS)
    }
    // Too late to get in step for this song, or it doesn't move on: it ends gapless.
    if (!host.movesOnNaturally) return skip(CrossfadeSkip.NoNext, POLL_MS)
    if (positionMs >= handoffAt) return skip(CrossfadeSkip.PastHandoff, POLL_MS)
    skipEvent = null
    val tail = host.openTail(positionMs + START_LEAD_MS)
    tail.setVolume(0f)
    phase = PreRoll(tail, host.currentKey, durationMs, handoffAt, overlap)
    return TICK_MS
  }

  /**
   * The tail getting in step. A queue sync leaving no next song for a moment
   * and a rebuffer of the session's player (the tail waits with it) don't
   * call it off. Once the overlap is due, a tail a little further off than
   * [IN_STEP_MS] will do ([LATE_IN_STEP_MS]); one still out of step keeps
   * trying, and the overlap starts late, over what's left, once it's in step
   * ([overlapOnceReady]), or the song ends gapless when too little is left.
   */
  private fun preRoll(current: PreRoll): Long? {
    val main = host.main
    if (overlapMs <= 0) return callOff(CrossfadeEnd.Off)
    if (!host.mainWantsToPlay) return callOff(CrossfadeEnd.Paused)
    val due = main.positionMs >= current.handoffAtMs
    if (due && !host.movesOnNaturally) return callOff(CrossfadeEnd.NoNext)
    val tail = current.tail
    if (!main.isPlaying) {
      tail.setPlaying(false)
      return TICK_MS
    }
    tail.setPlaying(true)
    val offset = tail.positionMs - main.positionMs
    if (due) {
      if (tail.isPlaying && abs(offset) <= LATE_IN_STEP_MS) return overlapOnceReady(current)
      val leftMs = current.durationMs - main.positionMs
      if (CrossfadeTiming.lateOverlap(current.overlapMs, leftMs) <= 0) return callOff(CrossfadeEnd.NotInStep)
    }
    when {
      !tail.isPlaying -> {}
      abs(offset) <= IN_STEP_MS -> tail.setSpeed(1f)
      abs(offset) > RESEEK_MS -> tail.seekTo(main.positionMs + START_LEAD_MS)
      else -> tail.setSpeed((1f - offset.toFloat() / CATCH_UP_MS).coerceIn(MIN_SPEED, MAX_SPEED))
    }
    return TICK_MS
  }

  /**
   * The overlap's time has come (or gone) and the tail is in step: the
   * overlap starts now if the next song is ready, over the time left
   * ([CrossfadeTiming.lateOverlap]). Otherwise the outgoing song plays on at
   * full volume on the session's player (the tail silent, in step) and this
   * is asked again each tick, until the next song is ready, or too little is
   * left and the song ends gapless.
   */
  private fun overlapOnceReady(current: PreRoll): Long {
    val main = host.main
    val overlap = CrossfadeTiming.lateOverlap(current.overlapMs, current.durationMs - main.positionMs)
    if (overlap <= 0) {
      val why = if (host.nextSearching) CrossfadeSkip.Searching else CrossfadeSkip.NotReady
      giveUp(why, lateMs = main.positionMs - current.handoffAtMs)
      cancel()
      return POLL_MS
    }
    if (!host.nextReady) return TICK_MS
    val incomingKey = host.nextKey
    current.tail.setSpeed(1f)
    current.tail.setVolume(1f)
    main.setVolume(0f)
    val leftMs = current.durationMs - main.positionMs
    phase = Fading(
      current.tail,
      incomingKey,
      endMs = current.durationMs,
      upToMs = overlap,
      fullMs = current.overlapMs,
      leftMs = leftMs,
      startedAtMs = host.nowMs,
      playing = host.mainWantsToPlay,
    )
    prefetched = false
    owed = true
    host.advance()
    return TICK_MS
  }

  private fun fading(current: Fading): Long? {
    val main = host.main
    current.step(host.nowMs, host.mainWantsToPlay)
    val sounding = current.tail
    // The overlap's clock starts once the incoming song sounds: until then
    // the outgoing song plays on at full volume.
    if (current.overlapMs == null && sounding != null && main.isPlaying) {
      val overlap = min(current.upToMs, current.endMs - sounding.positionMs + main.positionMs)
      current.overlapMs = overlap
      current.soundedAtRunMs = current.runMs
    }
    val overlap = current.overlapMs
    // Bounded by real time too: an overlap whose positions stop advancing still ends.
    if (current.outlasted(OVERDUE_MS)) {
      if (current.tail != null) cut(current, CrossfadeEnd.Overdue)
      endTail(current)
      main.setVolume(1f)
      phase = Idle
      return tick()
    }
    current.tail?.let { tail ->
      val leftMs = current.endMs - tail.positionMs
      // A tail that failed or stalled never gets there: the session's player,
      // as far into the next song as the overlap is long, says it should have.
      val overdue = overlap != null && main.positionMs >= overlap + OVERDUE_MS
      if (tail.ended || leftMs <= 0 || overdue) {
        // Over before the incoming song sounded: a gapless move after all.
        when {
          overlap == null -> report(CrossfadeOutcome.Skipped(CrossfadeSkip.NotReady, current.fullMs))
          !tail.ended && leftMs > 0 -> cut(current, CrossfadeEnd.Stalled)
          else -> report(CrossfadeOutcome.Done(overlap, current.fullMs - overlap))
        }
        endTail(current)
      } else {
        tail.setVolume(if (overlap == null) 1f else gain(leftMs.toFloat() / overlap))
      }
    }
    if (current.tail == null && (overlap == null || main.positionMs >= overlap)) {
      main.setVolume(1f)
      phase = Idle
      return tick()
    }
    main.setVolume(if (overlap == null) 0f else gain(main.positionMs.toFloat() / overlap))
    return if (host.mainWantsToPlay) TICK_MS else null
  }

  /** Reports the overlap's song change, once. */
  private fun report(outcome: CrossfadeOutcome) {
    if (!owed) return
    owed = false
    host.outcome(outcome)
  }

  private fun cut(current: Fading, why: CrossfadeEnd) {
    val elapsedMs = if (current.overlapMs == null) current.runMs else current.runMs - current.soundedAtRunMs
    report(CrossfadeOutcome.Cut(why, elapsedMs, current.overlapMs))
  }

  /** This song won't overlap the next for [why], as things stand; returns [delayMs]. */
  private fun skip(why: CrossfadeReason, delayMs: Long?): Long? {
    skipState = why
    return delayMs
  }

  private fun endTail(current: Fading) {
    if (current.tail == null) return
    host.closeTail()
    current.tail = null
    host.fadeEnded()
  }

  private fun cancel() {
    host.closeTail()
    phase = Idle
  }

  /** Calls the pre-roll off for [why], and goes on as if there was none. */
  private fun callOff(why: CrossfadeEnd): Long? {
    giveUp(why)
    cancel()
    return tick()
  }

  private companion object {
    /** How often volumes and timing are brought up to date around an overlap. */
    const val TICK_MS = 50L

    /** How often a playing song is looked at while its overlap is far off. */
    const val POLL_MS = 1000L

    /** Roughly how long a player takes to start sounding; the tail opens this far ahead. */
    const val START_LEAD_MS = 150L

    /** How long past the overlap a tail still not done is given before it's closed. */
    const val OVERDUE_MS = 1000L

    /** Close enough for the handoff to go unheard. */
    const val IN_STEP_MS = 20L

    /** Close enough for the handoff once the overlap is due: a late overlap beats none. */
    const val LATE_IN_STEP_MS = 40L

    /** Further off than this, the tail seeks instead of catching up. */
    const val RESEEK_MS = 500L

    /** The tail catches up an offset over about this long. */
    const val CATCH_UP_MS = 1000f

    const val MIN_SPEED = 0.8f
    const val MAX_SPEED = 1.25f

    /** Equal-power fade: the two songs' loudness adds up to the same through the overlap. */
    fun gain(fraction: Float): Float = sin(fraction.coerceIn(0f, 1f) * PI.toFloat() / 2)
  }
}

/**
 * Core's crossfade timing (packages/core/src/crossfade.ts), which the service
 * runs without JS. Keep in step with Core.
 */
internal object CrossfadeTiming {
  /** How long before the overlap the tail opens to get in step (Core's `CROSSFADE_PRE_ROLL_MS`). */
  const val PREROLL_MS = 3000L

  /** How far ahead of the pre-roll the next song is made ready (Core's `CROSSFADE_PREFETCH_LEAD_MS`). */
  const val PREFETCH_LEAD_MS = 30_000L

  /** The shortest overlap a late next song still gets (Core's `MIN_LATE_CROSSFADE_MS`). */
  const val MIN_LATE_MS = 1000L

  /** Where in a song of [durationMs] the next one is made ready (Core's `crossfadePrefetchAt`). */
  fun prefetchAt(overlapMs: Long, durationMs: Long): Long =
    max(0L, durationMs - min(overlapMs, durationMs / 2) - PREROLL_MS - PREFETCH_LEAD_MS)

  /**
   * The overlap once a late next song is ready with [leftMs] of the outgoing
   * song to go; 0 is a gapless move (Core's `lateCrossfadeOverlap`).
   */
  fun lateOverlap(overlapMs: Long, leftMs: Long): Long = if (leftMs < MIN_LATE_MS) 0L else min(overlapMs, leftMs)
}
