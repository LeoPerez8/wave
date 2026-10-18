package expo.modules.wavenative.tags

import java.io.File

/** Which step of filling in a song's tags failed (Core's `TagWriteStep`). */
enum class TagWriteStep(val id: String) {
  /** Reading the file to write into. */
  READ("read"),

  /** Writing the tags (or the sidecar `.lrc`). */
  WRITE("write"),

  /** Reading the written file again for the index. */
  REINDEX("reindex"),
}

/** [cause], thrown at [step] of filling in a song's tags. */
class TagWriteStepException(val step: TagWriteStep, cause: Throwable) : Exception("${step.id}: $cause", cause)

/** Runs [block] as [step]: what it throws comes out as a [TagWriteStepException] naming the step. */
inline fun <T> TagWriteStep.attempt(block: () -> T): T =
  try {
    block()
  } catch (e: TagWriteStepException) {
    throw e
  } catch (e: Exception) {
    throw TagWriteStepException(this, e)
  }

/**
 * A tag write that failed, as JS logs it (Core's `TagWriteFailure`): the step,
 * the original exception's class and message, and whether the file was there
 * when it failed, with its size.
 */
data class TagWriteFailure(
  val step: TagWriteStep,
  val exception: String,
  val message: String,
  val fileExists: Boolean,
  val fileBytes: Long?,
) {
  /** `{ step, exception, message, fileExists, fileBytes }`; the size is a JS number, null when there's no file. */
  fun toMap(): Map<String, Any?> =
    mapOf(
      "step" to step.id,
      "exception" to exception,
      "message" to message,
      "fileExists" to fileExists,
      "fileBytes" to fileBytes?.toDouble(),
    )

  companion object {
    /** [failure] on [file], as the file is now. */
    fun of(failure: TagWriteStepException, file: File): TagWriteFailure {
      val cause = failure.cause ?: failure
      val exists = file.isFile
      return TagWriteFailure(
        step = failure.step,
        exception = cause.javaClass.name,
        message = cause.message.orEmpty(),
        fileExists = exists,
        fileBytes = if (exists) file.length() else null,
      )
    }
  }
}
