import assert from "node:assert/strict";
import { test } from "node:test";

import { showCardDate } from "./index.ts";

// Local wall-clock times, as a Ticketmaster date-time reads on a phone in the show's country.
const friday = new Date(2026, 10, 13, 21, 0).toISOString();

test("a show card's stub reads month, day, weekday and doors time in English", () => {
  assert.deepEqual(showCardDate("en", friday), {
    month: "Nov",
    day: "13",
    weekday: "Fri",
    time: "9:00 PM",
    spoken: "Friday, November 13, 9:00 PM",
  });
});

test("a show card's stub reads in Brazilian Portuguese, with a twenty-four-hour time", () => {
  assert.deepEqual(showCardDate("pt-BR", friday), {
    month: "nov",
    day: "13",
    weekday: "sex.",
    time: "21:00",
    spoken: "sexta-feira, 13 de novembro, 21:00",
  });
});

test("a date-only show has no time, in either language", () => {
  // Core's Ticketmaster parser keeps a date-only show until the end of its local day.
  const dateOnly = "2026-12-05T23:59:59";
  assert.deepEqual(showCardDate("en", dateOnly), {
    month: "Dec",
    day: "5",
    weekday: "Sat",
    time: null,
    spoken: "Saturday, December 5",
  });
  assert.equal(showCardDate("pt-BR", dateOnly).spoken, "sábado, 5 de dezembro");
  assert.equal(showCardDate("pt-BR", dateOnly).time, null);
});
