package expo.modules.wavenative.player

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RuntimeOwnersTest {
  @Test fun runtimeOwnersDoNotReleaseEachOther() {
    val owners = RuntimeOwners()
    owners.acquire("auto"); owners.acquire("downloads"); owners.release("auto")
    assertTrue(owners.isWanted())
    owners.acquire("auto"); owners.release("downloads")
    assertTrue(owners.isWanted())
    owners.release("auto"); assertFalse(owners.isWanted())
  }
}
