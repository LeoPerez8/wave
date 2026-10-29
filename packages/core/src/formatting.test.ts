import assert from "node:assert/strict";
import { test } from "node:test";

import { formatNumber, formatTime, formatDate } from "./index.ts";

test("numbers keep English grouping and use Brazilian separators in Portuguese", () => {
  assert.equal(formatNumber("en", 1234), "1,234");
  assert.equal(formatNumber("pt-BR", 1234), "1.234");
  assert.equal(formatNumber("en", 1234.5), "1,234.5");
  assert.equal(formatNumber("pt-BR", 1234.5), "1.234,5");
  assert.equal(formatNumber("en", 0), "0");
  assert.equal(formatNumber("pt-BR", 0), "0");
});

const afternoon = new Date(2026, 9, 28, 14, 5);

test("times keep the English twelve-hour shape and use a Brazilian twenty-four-hour clock", () => {
  assert.equal(formatTime("en", afternoon), "2:05 PM");
  assert.equal(formatTime("pt-BR", afternoon), "14:05");
  assert.equal(formatTime("en", new Date(2026, 9, 28, 0, 5)), "12:05 AM");
  assert.equal(formatTime("pt-BR", new Date(2026, 9, 28, 0, 5)), "00:05");
});

test("calendar dates use the app language and keep existing English history shapes", () => {
  assert.equal(formatDate("en", afternoon, { weekday: "long" }), "Wednesday");
  assert.equal(formatDate("pt-BR", afternoon, { weekday: "long" }), "quarta-feira");
  const full = { month: "long", day: "numeric", year: "numeric" } as const;
  assert.equal(formatDate("en", afternoon, full), "October 28, 2026");
  assert.equal(formatDate("pt-BR", afternoon, full), "28 de outubro de 2026");
  assert.equal(formatDate("en", afternoon), "Oct 28");
  assert.equal(formatDate("pt-BR", afternoon), "28 de out.");
});
