import { Action, ActionPanel, Icon, Keyboard } from "@raycast/api";
import type { SpeedTest } from "../hooks/useSpeedTest";
import { jsonReport, textReport } from "../lib/report";
import { LIVE_MODE, SAMPLE_MODES, SAMPLE_STAGES, type RunMode } from "../lib/run-modes";
import { SAMPLE_SCENARIOS, SAMPLE_STAGE_TITLES } from "../lib/sample-run";
import { MetricsExplainer } from "./metrics-explainer";

interface SpeedTestActionsProps {
  test: SpeedTest;
  mode: RunMode;
  onSwitchMode?: (mode: RunMode) => void;
}

export function SpeedTestActions({ test, mode, onSwitchMode }: SpeedTestActionsProps) {
  const finished = test.phase === "finished";

  return (
    <ActionPanel>
      <ActionPanel.Section>
        <Action
          title={test.isRunning ? "Restart Test" : "Run Again"}
          icon={Icon.ArrowClockwise}
          shortcut={Keyboard.Shortcut.Common.Refresh}
          onAction={test.restart}
        />
        {finished && <Action.CopyToClipboard title="Copy Results" content={textReport(test)} />}
        {finished && (
          <Action.CopyToClipboard
            title="Copy Results as JSON"
            icon={Icon.Code}
            content={jsonReport(test)}
            shortcut={Keyboard.Shortcut.Common.Copy}
          />
        )}
      </ActionPanel.Section>
      <ActionPanel.Section>
        <Action.Push
          title="About These Metrics"
          icon={Icon.QuestionMarkCircle}
          shortcut={{ modifiers: ["cmd"], key: "i" }}
          target={<MetricsExplainer />}
        />
        <Action.OpenInBrowser title="Open Cloudflare Speed Test" url="https://speed.cloudflare.com" />
      </ActionPanel.Section>
      {onSwitchMode && (
        <ActionPanel.Section title="Development">
          {mode.kind !== "live" && (
            <Action title="Run Real Test" icon={Icon.Network} onAction={() => onSwitchMode(LIVE_MODE)} />
          )}
          <ActionPanel.Submenu title="Show Sample Result" icon={Icon.Eye}>
            {SAMPLE_MODES.map((scenario) => (
              <Action
                key={scenario}
                title={SAMPLE_SCENARIOS[scenario].title}
                onAction={() => onSwitchMode({ kind: "result", scenario })}
              />
            ))}
          </ActionPanel.Submenu>
          <ActionPanel.Submenu title="Show Sample Stage" icon={Icon.Pause}>
            {SAMPLE_STAGES.map((stage) => (
              <Action
                key={stage}
                title={SAMPLE_STAGE_TITLES[stage]}
                onAction={() => onSwitchMode({ kind: "stage", scenario: "typical", stage })}
              />
            ))}
          </ActionPanel.Submenu>
          <ActionPanel.Submenu title="Replay Sample" icon={Icon.Play}>
            {SAMPLE_MODES.map((scenario) => (
              <Action
                key={scenario}
                title={SAMPLE_SCENARIOS[scenario].title}
                onAction={() => onSwitchMode({ kind: "replay", scenario })}
              />
            ))}
          </ActionPanel.Submenu>
        </ActionPanel.Section>
      )}
    </ActionPanel>
  );
}
