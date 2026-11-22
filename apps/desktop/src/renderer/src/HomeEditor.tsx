/**
 * Home's editor (docs/spec.md, Editable Home): the sections Home shows, in order, each with
 * Move Up, Move Down and Remove, Discover's rows under Discover, then the sections it doesn't
 * show, each with Add. A row can also be dragged to its place. Every change is one
 * `wave.home.edit` call, which main checks and applies to the synced arrangement by Core's
 * rules, so Home and the phone follow at once.
 */
import {
  discoverRowTitle,
  editHomeArrangement,
  hiddenDiscoverRows,
  hiddenHomeSections,
  homeSectionTitle,
  type HomeArrangement,
  type HomeArrangementEdit,
} from "@wave/core";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { DESKTOP_SKIPPED_SECTIONS } from "../../shared/home.ts";
import { Icon } from "./Icon.tsx";
import { trapTab } from "./SongActions.tsx";
import { labels, text } from "./text.ts";
import "./homeEditor.css";

type ListEdit<Id> =
  | { readonly remove: Id }
  | { readonly add: Id }
  | { readonly move: { readonly from: number; readonly to: number } };

/** The button that takes focus once a change is drawn, so the keyboard carries on from it. */
interface FocusNext {
  readonly item: string;
  readonly action: "up" | "down" | "remove" | "add";
}

/**
 * One list of the editor: [shown] in order, then [hidden] with Add. [name] keeps its items'
 * ids apart from another list's. Buttons that can't act stay focusable (`aria-disabled`), so
 * moving a row to the top doesn't drop the keyboard's place.
 */
function ArrangementList<Id extends string>({
  name,
  label,
  shown,
  hidden,
  title,
  place,
  canRemove = true,
  edit,
  nested,
  hiddenHeading,
}: {
  readonly name: string;
  readonly label: string;
  readonly shown: readonly Id[];
  readonly hidden: readonly Id[];
  readonly title: (id: Id) => string;
  readonly place: { readonly from: string; readonly to: string };
  readonly canRemove?: boolean;
  readonly edit: (change: ListEdit<Id>, focus: FocusNext | null) => void;
  readonly nested?: (id: Id) => ReactNode;
  /** Given, the hidden items get their own headed list; without it they follow the shown ones. */
  readonly hiddenHeading?: string;
}) {
  const [dragging, setDragging] = useState<number>();
  const [over, setOver] = useState<number>();
  const key = (id: Id) => `${name}:${id}`;
  const move = (id: Id, from: number, to: number, action: "up" | "down") => {
    if (to < 0 || to >= shown.length) return;
    edit({ move: { from, to } }, { item: key(id), action });
  };
  const remove = (id: Id, at: number) => {
    if (!canRemove) return;
    const neighbour = shown[at + 1] ?? shown[at - 1];
    edit(
      { remove: id },
      neighbour === undefined
        ? { item: key(id), action: "add" }
        : { item: key(neighbour), action: "remove" },
    );
  };
  const rows = shown.map((id, at) => (
    <li
      key={id}
      data-item={key(id)}
      className={`home-editor-row${dragging === at ? " dragging" : ""}${
        over === at && dragging !== undefined && dragging !== at
          ? dragging < at
            ? " drop-after"
            : " drop-before"
          : ""
      }`}
      draggable
      onDragStart={(event) => {
        event.stopPropagation();
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", title(id));
        setDragging(at);
      }}
      onDragEnd={(event) => {
        event.stopPropagation();
        setDragging(undefined);
        setOver(undefined);
      }}
      onDragOver={(event) => {
        // A row dragged in another list (Discover's rows over Home's sections) isn't taken here.
        if (dragging === undefined) return;
        event.preventDefault();
        event.stopPropagation();
        setOver(at);
      }}
      onDrop={(event) => {
        if (dragging === undefined) return;
        event.preventDefault();
        event.stopPropagation();
        if (dragging !== at) edit({ move: { from: dragging, to: at } }, null);
        setDragging(undefined);
        setOver(undefined);
      }}
    >
      <div className="home-editor-line">
        <span className="home-editor-grip" aria-hidden="true">
          <Icon name="grip" size={16} />
        </span>
        <span className="home-editor-title truncate">{title(id)}</span>
        <button
          type="button"
          className="icon-button"
          data-action="up"
          aria-label={`${text.arrangement.moveUp}: ${title(id)}`}
          title={text.arrangement.moveUp}
          aria-disabled={at === 0}
          onClick={() => move(id, at, at - 1, "up")}
        >
          <Icon name="up" size={16} />
        </button>
        <button
          type="button"
          className="icon-button"
          data-action="down"
          aria-label={`${text.arrangement.moveDown}: ${title(id)}`}
          title={text.arrangement.moveDown}
          aria-disabled={at === shown.length - 1}
          onClick={() => move(id, at, at + 1, "down")}
        >
          <Icon name="down" size={16} />
        </button>
        <button
          type="button"
          className="icon-button"
          data-action="remove"
          aria-label={text.arrangement.remove(title(id), place.from)}
          title={text.arrangement.removeAction(place.from)}
          aria-disabled={!canRemove}
          onClick={() => remove(id, at)}
        >
          <Icon name="minus" size={16} />
        </button>
      </div>
      {nested?.(id)}
    </li>
  ));
  const added = hidden.map((id) => (
    <li key={id} data-item={key(id)} className="home-editor-row hidden-row">
      <div className="home-editor-line">
        <span className="home-editor-grip" aria-hidden="true" />
        <span className="home-editor-title truncate secondary">{title(id)}</span>
        <button
          type="button"
          className="icon-button"
          data-action="add"
          aria-label={text.arrangement.add(title(id), place.to)}
          title={text.arrangement.add(title(id), place.to)}
          onClick={() => edit({ add: id }, { item: key(id), action: "remove" })}
        >
          <Icon name="add" size={16} />
        </button>
      </div>
    </li>
  ));
  const headingId = useId();
  return hiddenHeading === undefined ? (
    <ol className="home-editor-list" aria-label={label}>
      {rows}
      {added}
    </ol>
  ) : (
    <>
      <ol className="home-editor-list" aria-label={label} data-list="shown">
        {rows}
      </ol>
      {added.length > 0 && (
        <>
          <h3 id={headingId} className="home-editor-heading">
            {hiddenHeading}
          </h3>
          <ul className="home-editor-list" aria-labelledby={headingId} data-list="hidden">
            {added}
          </ul>
        </>
      )}
    </>
  );
}

/**
 * The editor itself, for Settings › Home and for Home's dialog. It re-reads the arrangement on
 * [revision] (an account pull) and calls [onChanged] after each change main kept.
 */
export function HomeEditor({
  revision,
  onChanged,
  onError,
}: {
  readonly revision: number;
  readonly onChanged?: () => void;
  readonly onError: () => void;
}) {
  const [arrangement, setArrangement] = useState<HomeArrangement>();
  const [reread, setReread] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const focus = useRef<FocusNext | null>(null);
  useEffect(() => {
    let current = true;
    void window.wave.home
      .arrangement()
      .then((read) => {
        if (current) setArrangement(read);
      })
      .catch(onError);
    return () => {
      current = false;
    };
  }, [revision, reread, onError]);
  useLayoutEffect(() => {
    const next = focus.current;
    if (next === null) return;
    focus.current = null;
    root.current
      ?.querySelector<HTMLElement>(`[data-item="${next.item}"] [data-action="${next.action}"]`)
      ?.focus();
  }, [arrangement]);
  const edit = useCallback(
    (change: HomeArrangementEdit, next: FocusNext | null) => {
      focus.current = next;
      // Drawn at once by the rules main applies; what main kept then replaces it.
      setArrangement((current) => current && editHomeArrangement(current, change));
      void window.wave.home.edit(change).then(
        (kept) => {
          setArrangement(kept);
          onChanged?.();
        },
        () => {
          setReread((value) => value + 1);
          onError();
        },
      );
    },
    [onChanged, onError],
  );
  if (arrangement === undefined)
    return (
      <p className="secondary" role="status">
        {labels.loading}
      </p>
    );
  return (
    <div className="home-editor" ref={root} data-testid="home-editor">
      <ArrangementList
        name="section"
        label={text.home.edit}
        shown={arrangement.sections}
        hidden={hiddenHomeSections(arrangement, DESKTOP_SKIPPED_SECTIONS)}
        title={(id) => homeSectionTitle(id, text)}
        place={text.arrangement.home}
        hiddenHeading={text.home.notOnHome}
        edit={edit}
        nested={(id) =>
          id === "discover" ? (
            <ArrangementList
              name="row"
              label={text.home.sections.discover}
              shown={arrangement.discoverRows}
              hidden={hiddenDiscoverRows(arrangement)}
              title={(row) => discoverRowTitle(row, text)}
              place={text.arrangement.discover}
              canRemove={arrangement.discoverRows.length > 1}
              edit={(discover, next) => edit({ discover }, next)}
            />
          ) : null
        }
      />
    </div>
  );
}

/** Settings › Home: the editor as a page. Each change is kept as it is made. */
export function HomeSettings({
  revision,
  onError,
}: {
  readonly revision: number;
  readonly onError: () => void;
}) {
  return (
    <>
      <h2>{text.home.edit}</h2>
      <HomeEditor revision={revision} onError={onError} />
    </>
  );
}

/**
 * Home's Edit control: it opens the editor in a dialog over Home, which redraws behind it on
 * each change ([onChanged]). Esc or Done closes it and focus goes back to the button.
 */
export function HomeEditButton({
  revision,
  onChanged,
  onError,
}: {
  readonly revision: number;
  readonly onChanged: () => void;
  readonly onError: () => void;
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const done = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => {
    setOpen(false);
    button.current?.focus();
  }, []);
  useLayoutEffect(() => {
    if (open) done.current?.focus();
  }, [open]);
  // Esc closes from anywhere: after a drag the focus is on no button of the dialog.
  useEffect(() => {
    if (!open) return;
    const keys = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
      } else if (
        event.key === "Tab" &&
        !done.current?.closest(".dialog")?.contains(document.activeElement)
      ) {
        // Tab from outside the dialog comes back into it, never to Home behind it.
        event.preventDefault();
        done.current?.focus();
      }
    };
    window.addEventListener("keydown", keys, true);
    return () => window.removeEventListener("keydown", keys, true);
  }, [open, close]);
  return (
    <div className="home-edit">
      <button
        ref={button}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        {text.home.edit}
      </button>
      {open && (
        <div
          className="dialog-backdrop"
          onMouseDown={(e) => e.target === e.currentTarget && close()}
        >
          <div
            className="dialog home-editor-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="home-editor-title"
            onKeyDown={trapTab}
          >
            <h2 id="home-editor-title">{text.home.edit}</h2>
            <HomeEditor revision={revision} onChanged={onChanged} onError={onError} />
            <div className="dialog-buttons">
              <button ref={done} type="button" className="accent" onClick={close}>
                {text.arrangement.done}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
