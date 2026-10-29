import { useLocalisation } from "@/localisation/localisation";
import {
  editHomeArrangement,
  discoverRowTitle,
  hiddenDiscoverRows,
  hiddenHomeSections,
  homeSectionTitle,
  type HomeArrangement,
  type HomeArrangementEdit,
} from "@wave/core";
import { useCallback, useState } from "react";
import { View } from "react-native";

import { CELL } from "@/catalog/grid";

import { ArrangementEditor } from "@/components/ArrangementEditor";

/**
 * Home's editor: the sections Home shows (drag a handle to reorder, a button
 * removes one), then those it doesn't (a button adds one at the bottom).
 * The caller keeps [arrangement] and applies each [edit]; given
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
  const { strings } = useLocalisation();
  return (
    <ArrangementEditor
      shown={arrangement.sections}
      hidden={hiddenHomeSections(arrangement)}
      title={(id) => homeSectionTitle(id, strings)}
      place={strings.arrangement.home}
      hiddenHeading={strings.home.notOnHome}
      edit={edit}
      renderNested={(id, onDraggingChange) =>
        id === "discover" ? (
          <View style={{ paddingLeft: CELL * 3 }}>
            <ArrangementEditor
              inline
              shown={arrangement.discoverRows}
              hidden={hiddenDiscoverRows(arrangement)}
              title={(id) => discoverRowTitle(id, strings)}
              place={strings.arrangement.discover}
              hiddenHeading=""
              canRemove={arrangement.discoverRows.length > 1}
              edit={(discover) => edit({ discover })}
              onDraggingChange={onDraggingChange}
            />
          </View>
        ) : null
      }
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
