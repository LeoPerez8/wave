package dev.leoperez.wave.stdio

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * A value the phone's module hands JS (the shared `toMap()`s: maps, lists, strings, numbers,
 * booleans and nulls) as JSON, so the desktop's JS gets the same shapes.
 */
fun jsonOf(value: Any?): JsonElement =
  when (value) {
    null -> JsonNull
    is JsonElement -> value
    is String -> JsonPrimitive(value)
    is Number -> JsonPrimitive(value)
    is Boolean -> JsonPrimitive(value)
    is Enum<*> -> JsonPrimitive(value.name)
    is Map<*, *> -> JsonObject(value.entries.associate { (k, v) -> k.toString() to jsonOf(v) })
    is Iterable<*> -> JsonArray(value.map(::jsonOf))
    is Array<*> -> JsonArray(value.map(::jsonOf))
    else -> error("No JSON for ${value.javaClass.simpleName}")
  }
