import {
  editHomeArrangement,
  hiddenHomeSections,
  homeSectionNote,
  homeSectionTitle,
  type HomeArrangement,
  type HomeArrangementEdit,
} from "@wave/core";
import { useCallback, useState } from "react";

import { ArrangementEditor } from "@/components/ArrangementEditor";
import { useYtMusicEnabled } from "@/settings/ytMusic";

/**
 * Home's editor: the sections Home shows (drag a handle to reorder, a button
 * removes one), then those it doesn't (a button adds one at the bottom). A
 * section that needs something that's off says so under its title ("Needs YT
 * Music"). The caller keeps [arrangement] and applies each [edit]; given
 * [onDone] it's the card's, with Done, and without it Settings › Layout ›
 * Home's page.
 */
export function HomeEditor({
  arrangement,
  edit,
  onDone,
}: {
  arrangement: HomeArrangement;
  edit: (change: HomeArrangementEdit) => void;
  onDone?: (() => void) | undefined;
}) {
  const ytMusic = useYtMusicEnabled();
  return (
    <ArrangementEditor
      shown={arrangement}
      hidden={hiddenHomeSections(arrangement)}
      title={homeSectionTitle}
      detail={(id) => homeSectionNote(id, { ytMusic })}
      place="Home"
      hiddenHeading="Not on Home"
      edit={edit}
      onDone={onDone}
    />
  );
}

/**
 * Home's editor in the card a long press on Home's title opens: the edits
 * stay in the card until Done hands the arrangement to [done]; until then
 * Home stays as it was.
 */
export function HomeEditorCard({
  initial,
  done,
}: {
  initial: HomeArrangement;
  done: (arrangement: HomeArrangement) => void;
}) {
  const [arrangement, setArrangement] = useState(initial);
  const edit = useCallback(
    (change: HomeArrangementEdit) =>
      setArrangement((current) => editHomeArrangement(current, change)),
    [],
  );
  return <HomeEditor arrangement={arrangement} edit={edit} onDone={() => done(arrangement)} />;
}
