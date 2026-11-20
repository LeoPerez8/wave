import { Icon } from "./Icon.tsx";

export function TableSortHeader({
  label,
  className,
  direction,
  onSort,
}: {
  readonly label: string;
  readonly className?: string | undefined;
  readonly direction?: "ascending" | "descending" | undefined;
  readonly onSort?: (() => void) | undefined;
}) {
  return (
    <span role="columnheader" className={className} aria-sort={direction}>
      {onSort ? (
        <button type="button" className="table-sort" onClick={onSort}>
          <span>{label}</span>
          {direction && <Icon name="back" size={12} />}
        </button>
      ) : (
        label
      )}
    </span>
  );
}
