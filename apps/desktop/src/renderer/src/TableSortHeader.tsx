import { Icon } from "./Icon.tsx";

export function TableSortHeader({
  label,
  name,
  className,
  direction,
  onSort,
}: {
  readonly label: string;
  /** What the header sorts by, where [label] is a sign (a playlist's "#"). */
  readonly name?: string | undefined;
  readonly className?: string | undefined;
  readonly direction?: "ascending" | "descending" | undefined;
  readonly onSort?: (() => void) | undefined;
}) {
  return (
    <span role="columnheader" className={className} aria-sort={direction}>
      {onSort ? (
        <button
          type="button"
          className="table-sort"
          onClick={onSort}
          aria-label={name}
          title={name}
        >
          <span>{label}</span>
          {direction && <Icon name="back" size={12} />}
        </button>
      ) : (
        label
      )}
    </span>
  );
}
