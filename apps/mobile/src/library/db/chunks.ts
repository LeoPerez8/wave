/** Ids per statement, well under SQLite's limit on bound values. */
const IDS_PER_STATEMENT = 500;

/**
 * [items] in runs of [size], one statement's worth each, so a statement
 * never binds more values than SQLite takes. The default suits one value
 * per item (an id, a path, a key); rows binding several take fewer.
 */
export const chunks = <A>(items: readonly A[], size = IDS_PER_STATEMENT): A[][] => {
  const out: A[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};
