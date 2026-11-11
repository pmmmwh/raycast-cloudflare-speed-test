import { runSpeedTest, type SpeedTestRunner } from "./engine/engine";
import {
  SAMPLE_SCENARIOS,
  SAMPLE_STAGE_TITLES,
  createSampleRunner,
  type SampleScenario,
  type SampleStage,
} from "./sample-run";

export type RunMode =
  | { kind: "live" }
  | { kind: "result"; scenario: SampleScenario }
  | { kind: "stage"; scenario: SampleScenario; stage: SampleStage }
  | { kind: "replay"; scenario: SampleScenario };

export const LIVE_MODE: RunMode = { kind: "live" };
export const SAMPLE_MODES = Object.keys(SAMPLE_SCENARIOS) as SampleScenario[];
export const SAMPLE_STAGES = Object.keys(SAMPLE_STAGE_TITLES) as SampleStage[];

export function modeKey(mode: RunMode): string {
  switch (mode.kind) {
    case "live":
      return "live";
    case "stage":
      return `stage:${mode.scenario}:${mode.stage}`;
    default:
      return `${mode.kind}:${mode.scenario}`;
  }
}

export function modeTitle(mode: RunMode): string | undefined {
  switch (mode.kind) {
    case "live":
      return;
    case "result":
      return `Sample Result: ${SAMPLE_SCENARIOS[mode.scenario].title}`;
    case "stage":
      return `Sample Stage: ${SAMPLE_STAGE_TITLES[mode.stage]}`;
    case "replay":
      return `Sample Replay: ${SAMPLE_SCENARIOS[mode.scenario].title}`;
  }
}

// Runners are cached so the same mode keeps a stable identity and does not restart the test on re-render.
const runners = new Map<string, SpeedTestRunner>();

export function runnerFor(mode: RunMode): SpeedTestRunner {
  const key = modeKey(mode);
  let runner = runners.get(key);
  if (!runner) {
    switch (mode.kind) {
      case "live":
        runner = runSpeedTest;
        break;
      case "result":
        runner = createSampleRunner(mode.scenario, { pace: 0 });
        break;
      case "stage":
        runner = createSampleRunner(mode.scenario, { pace: 0, freezeAt: mode.stage });
        break;
      case "replay":
        runner = createSampleRunner(mode.scenario);
        break;
    }
    runners.set(key, runner);
  }
  return runner;
}
