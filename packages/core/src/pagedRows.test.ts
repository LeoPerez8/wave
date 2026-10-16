import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createPagedRows, type PagedRowsLimits } from "./index.ts";

interface Row {
  readonly id: number;
  readonly title: string;
}

const LIMITS: PagedRowsLimits = { pageSize: 10, ahead: 1, keep: 2 };

const range = (from: number, count: number): number[] =>
  Array.from({ length: count }, (_, i) => from + i);

/** Paged rows over a database the test answers by hand: each read waits in [reads]. */
const setUp = (limits: PagedRowsLimits = LIMITS) => {
  const reads: { keys: readonly number[]; settle: (rows: readonly Row[] | null) => void }[] = [];
  let changes = 0;
  const rows = createPagedRows<number, Row>({
    read: (keys, settle) => reads.push({ keys, settle }),
    keyOf: (row) => row.id,
    limits,
  });
  rows.subscribe(() => changes++);
  /** Answers read [index] as the database would: every key found, titled [title]. */
  const answer = (index: number, title = "v1", found = (_id: number) => true) =>
    reads[index]!.settle(
      reads[index]!.keys.filter(found).map((id) => ({ id, title: `${title} ${id}` })),
    );
  const shown = (from: number, count: number) =>
    range(from, count).map((index) => rows.row(index)?.title);
  return { rows, reads, answer, shown, changes: () => changes };
};

describe("createPagedRows", () => {
  test("reads the first page and the next when the order arrives, then shows them", () => {
    const { rows, reads, answer, shown, changes } = setUp();
    rows.setOrder(range(1, 1_000));
    assert.deepEqual(
      reads.map((read) => read.keys),
      [range(1, 10), range(11, 10)],
    );
    assert.equal(rows.row(0), undefined);
    answer(0);
    assert.equal(changes(), 1);
    assert.deepEqual(shown(0, 3), ["v1 1", "v1 2", "v1 3"]);
    assert.equal(rows.row(10), undefined);
  });

  test("reads the pages around the rows on screen as the list scrolls, and lets far rows go", () => {
    const { rows, reads, answer, shown } = setUp();
    rows.setOrder(range(1, 1_000));
    answer(0);
    answer(1);
    // A jump down the A–Z spine: rows 500 to 519 on screen.
    rows.view(500, 520);
    assert.deepEqual(
      reads.slice(2).map((read) => read.keys[0]),
      [491, 501, 511, 521],
    );
    for (let index = 2; index < reads.length; index++) answer(index);
    assert.deepEqual(shown(500, 2), ["v1 501", "v1 502"]);
    // The top of the list is far behind now: its rows are no longer held.
    assert.equal(rows.row(0), undefined);
    // At most the pages on screen and `keep` each way.
    assert.ok(rows.stats().held <= (3 + 2 * LIMITS.keep) * LIMITS.pageSize);
    // Scrolling back reads the top again.
    rows.view(0, 15);
    assert.deepEqual(
      reads.slice(6).map((read) => read.keys[0]),
      [1, 11, 21],
    );
  });

  test("asks nothing again for rows already read and on screen", () => {
    const { rows, reads, answer } = setUp();
    rows.setOrder(range(1, 100));
    answer(0);
    answer(1);
    rows.view(3, 12);
    rows.view(0, 10);
    assert.equal(reads.length, 3);
    assert.deepEqual(reads[2]!.keys, range(21, 10));
  });

  test("a new order shows each place's own row: rows read before move with their keys", () => {
    const { rows, reads, answer, shown } = setUp();
    rows.setOrder(range(1, 30));
    answer(0);
    answer(1);
    // A rescan found a song that sorts first; song 5 was deleted.
    rows.setOrder([100, ...range(1, 4), ...range(6, 25)]);
    assert.deepEqual(shown(0, 6), [undefined, "v1 1", "v1 2", "v1 3", "v1 4", "v1 6"]);
    // Every key near the screen is read again, as the rows may have changed too.
    assert.deepEqual(reads[2]!.keys, [100, ...range(1, 4), ...range(6, 5)]);
    answer(2, "v2");
    assert.deepEqual(shown(0, 3), ["v2 100", "v2 1", "v2 2"]);
  });

  test("a read that started before a new order never replaces the new order's rows", () => {
    const { rows, reads, answer, shown } = setUp();
    rows.setOrder(range(1, 20));
    // A tag edit lands while the first page is being read.
    rows.setOrder(range(1, 20));
    assert.deepEqual(
      reads.map((read) => read.keys[0]),
      [1, 11, 1, 11],
    );
    answer(2, "v2");
    answer(0, "v1");
    assert.deepEqual(shown(0, 2), ["v2 1", "v2 2"]);
    assert.equal(rows.stats().staleRows, 10);
  });

  test("an older read's rows show until the new order's arrive, and are then read again", () => {
    const { rows, reads, answer, shown } = setUp({ pageSize: 10, ahead: 0, keep: 0 });
    rows.setOrder(range(1, 10));
    rows.setOrder(range(1, 10));
    answer(0, "v1");
    assert.deepEqual(shown(0, 1), ["v1 1"]);
    // Read once for the first order and once for the second, not a third time.
    assert.equal(reads.length, 2);
    answer(1, "v2");
    assert.deepEqual(shown(0, 1), ["v2 1"]);
  });

  test("a key the read no longer finds stays a placeholder, not asked again until a new order", () => {
    const { rows, reads, answer, shown } = setUp({ pageSize: 10, ahead: 0, keep: 0 });
    rows.setOrder(range(1, 10));
    answer(0, "v1", (id) => id !== 3);
    assert.deepEqual(shown(1, 3), ["v1 2", undefined, "v1 4"]);
    rows.view(0, 10);
    assert.equal(reads.length, 1);
    rows.setOrder([...range(1, 2), ...range(4, 7)]);
    assert.deepEqual(reads[1]!.keys, [...range(1, 2), ...range(4, 7)]);
  });

  test("finds a held row by its key too, wherever the order puts it", () => {
    const { rows, answer } = setUp({ pageSize: 10, ahead: 0, keep: 0 });
    rows.setOrder(range(1, 10));
    answer(0);
    assert.equal(rows.rowOf(7)?.title, "v1 7");
    assert.equal(rows.rowOf(70), undefined);
  });

  test("a failed read is asked again when the list next moves", () => {
    const { rows, reads, shown } = setUp({ pageSize: 10, ahead: 0, keep: 0 });
    rows.setOrder(range(1, 10));
    reads[0]!.settle(null);
    assert.deepEqual(shown(0, 1), [undefined]);
    rows.view(0, 10);
    assert.deepEqual(reads[1]!.keys, range(1, 10));
  });

  test("an empty list reads nothing", () => {
    const { rows, reads } = setUp();
    rows.setOrder([]);
    rows.view(0, 10);
    assert.equal(reads.length, 0);
    assert.equal(rows.row(0), undefined);
  });
});
