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
 * Home's editor, opened by a long press on Home's title: the sections Home
 * shows (drag a handle to reorder, a button removes one), then those it
 * doesn't (a button adds one at the bottom). A section that needs something
 * that's off says so under its title ("Needs YT Music"). Done hands the
 * arrangement to [done]; until then Home stays as it was.
 */
export function HomeEditor({
  initial,
  done,
}: {
  initial: HomeArrangement;
  done: (arrangement: HomeArrangement) => void;
}) {
  const [arrangement, setArrangement] = useState(initial);
  const ytMusic = useYtMusicEnabled();
  const edit = useCallback(
    (change: HomeArrangementEdit) =>
      setArrangement((current) => editHomeArrangement(current, change)),
    [],
  );
  return (
    <ArrangementEditor
      shown={arrangement}
      hidden={hiddenHomeSections(arrangement)}
      title={homeSectionTitle}
      detail={(id) => homeSectionNote(id, { ytMusic })}
      place="Home"
      hiddenHeading="Not on Home"
      edit={edit}
      onDone={() => done(arrangement)}
    />
  );
}
