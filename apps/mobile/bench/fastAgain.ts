import { FAST_AGAIN_DESKTOP } from "../src/library/db/fastAgainFixture.ts";
import { main } from "./fastAgain/runner.ts";

try {
  await main();
} catch (error) {
  console.error(
    JSON.stringify({
      kind: "error",
      message: error instanceof Error ? error.message : String(error),
      note: FAST_AGAIN_DESKTOP,
    }),
  );
  process.exitCode = 1;
}
