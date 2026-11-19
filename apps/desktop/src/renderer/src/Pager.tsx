import { text } from "./text.ts";

export function Pager({
  page,
  pageSize,
  previous,
  next,
}: {
  readonly page:
    | { readonly offset: number; readonly total: number; readonly items: readonly unknown[] }
    | undefined;
  readonly pageSize: number;
  readonly previous: () => void;
  readonly next: () => void;
}) {
  if (page === undefined || page.total <= pageSize) return null;
  return (
    <div className="mt-4 flex items-center justify-end gap-3 text-sm text-secondary">
      <button disabled={page.offset === 0} onClick={previous}>
        {text.desktopLibrary.previous}
      </button>
      <span className="tabular-nums">
        {text.desktopLibrary.page(page.offset + 1, page.offset + page.items.length, page.total)}
      </span>
      <button disabled={page.offset + page.items.length >= page.total} onClick={next}>
        {text.desktopLibrary.next}
      </button>
    </div>
  );
}
