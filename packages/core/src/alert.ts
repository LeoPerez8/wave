/**
 * Wave's alert dialog: a title, a message and one or two buttons, on a glass
 * card. Decide which buttons it shows and what Back or a tap outside means.
 */

export interface AlertSpec {
  readonly title: string;
  readonly message: string;
  /** Makes it a confirmation: Cancel and this action. Without one it is a message with OK. */
  readonly action?: {
    readonly label: string;
    /** Deletes or removes something: shown in the destructive colour. */
    readonly destructive?: boolean;
  };
}

/** What the person chose: the action, or Cancel / OK. */
export type AlertChoice = "action" | "dismiss";

export interface AlertButton {
  readonly label: string;
  readonly tone: "accent" | "destructive";
  readonly choice: AlertChoice;
}

export interface AlertPlan {
  /** Left to right. */
  readonly buttons: readonly AlertButton[];
  /** The choice Back or a tap outside the card makes: Cancel or OK. */
  readonly dismissed: AlertChoice;
  /** What a screen reader says as the card opens: the title, then the message. */
  readonly announcement: string;
}

/** A title reads as a sentence: "Wave is scanning" gets a full stop, "Delete X?" keeps its mark. */
const asSentence = (title: string): string => (/[.?!…]$/.test(title) ? title : `${title}.`);

export const planAlert = ({ title, message, action }: AlertSpec): AlertPlan => ({
  announcement: `${asSentence(title)} ${message}`,
  buttons:
    action === undefined
      ? [{ label: "OK", tone: "accent", choice: "dismiss" }]
      : [
          { label: "Cancel", tone: "accent", choice: "dismiss" },
          {
            label: action.label,
            tone: action.destructive === true ? "destructive" : "accent",
            choice: "action",
          },
        ],
  dismissed: "dismiss",
});
