package expo.modules.wavenative.launcher

import android.content.SharedPreferences
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class LauncherIconRecordTest {
  /** SharedPreferences in memory; edits apply on commit. */
  private class MemoryPreferences : SharedPreferences {
    val values = mutableMapOf<String, Any?>()

    override fun getAll(): Map<String, *> = values.toMap()
    override fun getString(key: String, defValue: String?): String? = values[key] as String? ?: defValue
    override fun getStringSet(key: String, defValues: Set<String>?): Set<String>? = defValues
    override fun getInt(key: String, defValue: Int): Int = values[key] as Int? ?: defValue
    override fun getLong(key: String, defValue: Long): Long = values[key] as Long? ?: defValue
    override fun getFloat(key: String, defValue: Float): Float = values[key] as Float? ?: defValue
    override fun getBoolean(key: String, defValue: Boolean): Boolean = values[key] as Boolean? ?: defValue
    override fun contains(key: String): Boolean = key in values
    override fun registerOnSharedPreferenceChangeListener(l: SharedPreferences.OnSharedPreferenceChangeListener) = Unit
    override fun unregisterOnSharedPreferenceChangeListener(l: SharedPreferences.OnSharedPreferenceChangeListener) = Unit

    override fun edit(): SharedPreferences.Editor = object : SharedPreferences.Editor {
      private val puts = mutableMapOf<String, Any?>()
      private val removes = mutableSetOf<String>()
      private var clear = false

      override fun putString(key: String, value: String?) = apply { puts[key] = value }
      override fun putStringSet(key: String, values: Set<String>?) = apply { puts[key] = values }
      override fun putInt(key: String, value: Int) = apply { puts[key] = value }
      override fun putLong(key: String, value: Long) = apply { puts[key] = value }
      override fun putFloat(key: String, value: Float) = apply { puts[key] = value }
      override fun putBoolean(key: String, value: Boolean) = apply { puts[key] = value }
      override fun remove(key: String) = apply { removes += key }
      override fun clear() = apply { clear = true }
      override fun commit(): Boolean {
        if (clear) values.clear()
        removes.forEach { values.remove(it) }
        values.putAll(puts)
        return true
      }
      override fun apply() {
        commit()
      }
    }
  }

  private val preferences = MemoryPreferences()

  @Test
  fun `nothing is recorded before Wave first left an alias on`() {
    assertNull(LauncherIconRecord.lastApplied(preferences))
    assertNull(LauncherIconRecord.reconciled(preferences, installedAt = 1))
  }

  @Test
  fun `the alias an earlier build left on is still named after an update`() {
    LauncherIconRecord.save(preferences, installedAt = 1, alias = "LauncherIcon_gold_ember")
    // The update's manifest may differ, so the switcher checks every alias again...
    assertNull(LauncherIconRecord.reconciled(preferences, installedAt = 2))
    // ...while JS keeps the icon the phone shows.
    assertEquals("LauncherIcon_gold_ember", LauncherIconRecord.lastApplied(preferences))
  }

  @Test
  fun `the same install reads back the alias it reconciled`() {
    LauncherIconRecord.save(preferences, installedAt = 1, alias = "LauncherIcon_teal_ember")
    assertEquals("LauncherIcon_teal_ember", LauncherIconRecord.reconciled(preferences, installedAt = 1))
  }

  @Test
  fun `a switch that broke off names no alias`() {
    LauncherIconRecord.save(preferences, installedAt = 1, alias = "LauncherIcon_teal_ember")
    LauncherIconRecord.clear(preferences)
    assertNull(LauncherIconRecord.lastApplied(preferences))
    assertNull(LauncherIconRecord.reconciled(preferences, installedAt = 1))
  }

  @Test
  fun `it reads the record the switcher wrote before it moved here`() {
    // The keys 0.36.2-ti's LauncherIconSwitcher wrote.
    preferences.values["installedAt"] = 1L
    preferences.values["appliedAlias"] = "LauncherIcon_coral_ember"
    assertEquals("LauncherIcon_coral_ember", LauncherIconRecord.lastApplied(preferences))
    assertEquals("LauncherIcon_coral_ember", LauncherIconRecord.reconciled(preferences, installedAt = 1))
  }
}
