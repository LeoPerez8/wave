package expo.modules.wavenative.launcher

import org.junit.Assert.assertEquals
import org.junit.Test

class LauncherAliasesTest {
  private val aliases = listOf("LauncherIcon_teal_ember", "LauncherIcon_blue_ember", "LauncherIcon_teal_gold")

  private fun plan(target: String, vararg enabled: String) =
    LauncherAliases.plan(target, aliases) { it in enabled }

  @Test
  fun repeatedAppliedIconDoesNotReadAnyAlias() {
    val manyAliases = (0 until 576).map { "LauncherIcon_$it" }
    assertEquals(
      emptyList<AliasChange>(),
      LauncherAliases.plan("LauncherIcon_42", manyAliases, appliedAlias = "LauncherIcon_42") {
        error("An unchanged icon must not query PackageManager")
      },
    )
  }

  @Test
  fun firstReconciliationChecksManifestDefaultsEvenWhenTheTargetIsOn() {
    val manyAliases = (0 until 576).map { "LauncherIcon_$it" }
    val reads = mutableListOf<String>()
    assertEquals(
      listOf(AliasChange("LauncherIcon_0", enabled = false)),
      LauncherAliases.plan("LauncherIcon_42", manyAliases) {
        reads += it
        it == "LauncherIcon_0" || it == "LauncherIcon_42"
      },
    )
    assertEquals(576, reads.size)
  }

  @Test
  fun aNewRequestStillReconcilesAllAliases() {
    assertEquals(
      listOf(
        AliasChange("LauncherIcon_blue_ember", enabled = true),
        AliasChange("LauncherIcon_teal_ember", enabled = false),
      ),
      LauncherAliases.plan("LauncherIcon_blue_ember", aliases, appliedAlias = "LauncherIcon_teal_ember") {
        it == "LauncherIcon_teal_ember"
      },
    )
  }

  @Test
  fun nothingToDoWhenTheTargetIsAlreadyTheOnlyOneOn() {
    assertEquals(emptyList<AliasChange>(), plan("LauncherIcon_teal_ember", "LauncherIcon_teal_ember"))
  }

  @Test
  fun enablesTheNewIconBeforeDisablingTheOld() {
    assertEquals(
      listOf(
        AliasChange("LauncherIcon_blue_ember", enabled = true),
        AliasChange("LauncherIcon_teal_ember", enabled = false),
      ),
      plan("LauncherIcon_blue_ember", "LauncherIcon_teal_ember"),
    )
  }

  @Test
  fun leavesExactlyOneIconOn() {
    assertEquals(
      listOf(
        AliasChange("LauncherIcon_teal_ember", enabled = false),
        AliasChange("LauncherIcon_blue_ember", enabled = false),
      ),
      plan("LauncherIcon_teal_gold", "LauncherIcon_teal_ember", "LauncherIcon_blue_ember", "LauncherIcon_teal_gold"),
    )
  }

  @Test
  fun ignoresAnUnknownIconSoWaveNeverLeavesTheAppDrawer() {
    assertEquals(emptyList<AliasChange>(), plan("LauncherIcon_nope", "LauncherIcon_teal_ember"))
  }
}
