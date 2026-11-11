import { useEffect, useState } from "react";
import { runSpeedTest, type SpeedTestRunner } from "../lib/engine/engine";
import { applyEvent, failRun, finishRun, initialRunState, isRunning, type RunState } from "../lib/run-state";

// Engine events arrive far faster than a Detail view can usefully redraw.
const RENDER_INTERVAL_MS = 100;

export interface SpeedTest extends RunState {
  frame: number;
  isRunning: boolean;
  restart: () => void;
}

export function useSpeedTest(runner: SpeedTestRunner = runSpeedTest): SpeedTest {
  const [runId, setRunId] = useState(0);
  const [{ state, frame }, setView] = useState({ state: initialRunState(), frame: 0 });

  useEffect(() => {
    const controller = new AbortController();
    const startedAt = performance.now();
    let draft = initialRunState();
    let pendingRender: NodeJS.Timeout | undefined;

    const render = () => {
      clearTimeout(pendingRender);
      pendingRender = undefined;
      setView((current) => ({ state: draft, frame: current.frame + 1 }));
    };
    const scheduleRender = () => {
      pendingRender ??= setTimeout(render, RENDER_INTERVAL_MS);
    };

    render();
    runner({
      signal: controller.signal,
      onEvent: (event, raw) => {
        draft = applyEvent(draft, event, raw);
        scheduleRender();
      },
    })
      .then((result) => {
        draft = finishRun(draft, result, performance.now() - startedAt);
        render();
      })
      .catch((error) => {
        if (controller.signal.aborted) {
          return;
        }
        draft = failRun(draft, error);
        render();
      });

    return () => {
      controller.abort();
      clearTimeout(pendingRender);
    };
  }, [runId, runner]);

  return { ...state, frame, isRunning: isRunning(state), restart: () => setRunId((id) => id + 1) };
}
