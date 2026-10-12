import { planAlert, type AlertChoice, type AlertPlan, type AlertSpec } from "@wave/core";
import { Text, View } from "react-native";

import { CELL } from "@/catalog/grid";
import { TextButton } from "@/components/TextButton";

import { presentOverlay } from "./overlay";

/** A title, a message and its buttons (right-aligned, the action last). */
function AlertCard({
  spec,
  plan,
  finish,
}: {
  spec: AlertSpec;
  plan: AlertPlan;
  finish: (choice: AlertChoice) => void;
}) {
  return (
    <>
      <View style={{ gap: CELL, paddingTop: CELL, paddingBottom: CELL * 2 }}>
        <Text className="font-sans text-title3 font-normal text-foreground">{spec.title}</Text>
        <Text className="font-sans text-subheadline text-secondary">{spec.message}</Text>
      </View>
      <View className="flex-row items-center justify-end" style={{ gap: CELL * 3 }}>
        {plan.buttons.map((button) => (
          <TextButton
            key={button.label}
            label={button.label}
            tone={button.tone}
            onPress={() => finish(button.choice)}
          />
        ))}
      </View>
    </>
  );
}

/**
 * Shows an alert on a glass card, from anywhere (React or not), and answers
 * with what was chosen. Back or a tap outside chooses Cancel / OK.
 */
export const showAlert = (spec: AlertSpec): Promise<AlertChoice> => {
  const plan = planAlert(spec);
  return presentOverlay<AlertChoice>({
    label: plan.announcement,
    dismissed: plan.dismissed,
    render: (finish) => <AlertCard spec={spec} plan={plan} finish={finish} />,
  });
};

/** A message with a single OK; resolves once it's dismissed. */
export const showMessage = async (title: string, message: string): Promise<void> => {
  await showAlert({ title, message });
};

/** A failure, titled e.g. "Couldn't add the folder", with the error's message. */
export const showError = (title: string, error: unknown): Promise<void> =>
  showMessage(title, error instanceof Error ? error.message : String(error));

/** Cancel and the action; resolves `true` only when the action is chosen. */
export const confirmAction = async (
  spec: AlertSpec & { readonly action: NonNullable<AlertSpec["action"]> },
): Promise<boolean> => (await showAlert(spec)) === "action";
