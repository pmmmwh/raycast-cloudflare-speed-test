import { Detail, Toast, environment, showToast } from "@raycast/api";
import { useEffect, useState } from "react";
import { SpeedTestActions } from "./components/speed-test-actions";
import { SpeedTestMetadata } from "./components/speed-test-metadata";
import { useSpeedTest } from "./hooks/useSpeedTest";
import { DARK_THEME, LIGHT_THEME } from "./lib/charts";
import { LIVE_MODE, modeKey, modeTitle, runnerFor, type RunMode } from "./lib/run-modes";
import { describeSkipped } from "./lib/run-state";
import { buildMarkdown } from "./lib/view";

// Development builds open on sample data so the UI can be reviewed without loading Cloudflare.
const INITIAL_MODE: RunMode = environment.isDevelopment ? { kind: "result", scenario: "typical" } : LIVE_MODE;

export default function Command() {
  const [mode, setMode] = useState(INITIAL_MODE);
  const test = useSpeedTest(runnerFor(mode));
  const theme = environment.appearance === "dark" ? DARK_THEME : LIGHT_THEME;
  const skippedNotice = test.phase === "finished" ? describeSkipped(test.skipped) : undefined;

  useEffect(() => {
    if (test.error) {
      showToast({ style: Toast.Style.Failure, title: "Speed Test failed", message: test.error });
    }
  }, [test.error]);

  useEffect(() => {
    if (skippedNotice) {
      showToast({ style: Toast.Style.Failure, title: "Some measurements were skipped" });
    }
  }, [skippedNotice]);

  const switchMode = (next: RunMode) => (modeKey(next) === modeKey(mode) ? test.restart() : setMode(next));

  return (
    <Detail
      navigationTitle={modeTitle(mode)}
      isLoading={test.isRunning}
      markdown={buildMarkdown(test, theme, test.frame)}
      metadata={<SpeedTestMetadata state={test} />}
      actions={
        <SpeedTestActions test={test} mode={mode} onSwitchMode={environment.isDevelopment ? switchMode : undefined} />
      }
    />
  );
}
