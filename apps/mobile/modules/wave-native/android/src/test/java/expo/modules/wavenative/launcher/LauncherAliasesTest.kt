package expo.modules.wavenative.launcher

import org.junit.Assert.assertEquals
import org.junit.Test

class LauncherAliasesTest {
  private val aliases = listOf("LauncherIcon_teal_ember", "LauncherIcon_blue_ember", "LauncherIcon_teal_gold")

  private fun plan(target: String, vararg enabled: String) =
    LauncherAliases.plan(target, aliases) { it in enabled }

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
