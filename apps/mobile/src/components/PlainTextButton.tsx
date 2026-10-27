import { TextButton, type TextButtonProps } from "./TextButton";

/** Compatibility name for the non-animated actions used by long Downloads lists (#446). */
export function PlainTextButton(props: Omit<TextButtonProps, "variant">) {
  return <TextButton {...props} variant="plain" />;
}
