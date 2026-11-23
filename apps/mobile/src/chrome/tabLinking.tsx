import { rememberPathStates } from "@wave/core";
import { LinkingContext } from "expo-router/react-navigation";
import { use, useMemo, type ReactNode } from "react";

type Linking = NonNullable<React.ContextType<typeof LinkingContext>["options"]>;
type GetStateFromPath = NonNullable<Linking["getStateFromPath"]>;

/** Each router read function's remembering form, shared by every tabs navigator that uses it. */
const remembered = new WeakMap<GetStateFromPath, GetStateFromPath>();

const remember = (read: GetStateFromPath): GetStateFromPath => {
  let kept = remembered.get(read);
  if (kept === undefined) {
    kept = rememberPathStates(read as never) as GetStateFromPath;
    remembered.set(read, kept);
  }
  return kept;
};

/**
 * The router's linking for the tabs navigator below, with its path reads remembered
 * (`rememberPathStates`): expo-router's tabs read every tab's route from its path on each
 * navigation, and the router builds its whole route config again for each read, which held a
 * tab switch's frame by tens of milliseconds (#1486). Each read still gets a state of its own.
 */
export function RememberedLinking({ children }: { children: ReactNode }) {
  const linking = use(LinkingContext);
  const value = useMemo(() => {
    const read = linking.options?.getStateFromPath;
    if (read === undefined) return linking;
    return { ...linking, options: { ...linking.options, getStateFromPath: remember(read) } };
  }, [linking]);
  return <LinkingContext.Provider value={value}>{children}</LinkingContext.Provider>;
}
