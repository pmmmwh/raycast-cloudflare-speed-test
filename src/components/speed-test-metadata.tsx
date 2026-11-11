import { Color, Detail, Icon, type Image } from "@raycast/api";
import { EXPERIENCE_TITLES, RATING_TITLES, networkName, ratingStars, serverLocation } from "../lib/report";
import { describeStatus, type RunState } from "../lib/run-state";
import type { Experience } from "../lib/scores";
import { latencyValue, packetLossValue } from "../lib/view";
import { METHODOLOGY_URL } from "./metrics-explainer";

const EXPERIENCE_ICONS: Record<Experience, Icon> = {
  streaming: Icon.Livestream,
  gaming: Icon.GameController,
  videoCalls: Icon.Video,
};

function statusIcon(state: RunState): Image.ImageLike {
  switch (state.phase) {
    case "finished":
      return { source: Icon.CheckCircle, tintColor: Color.Green };
    case "failed":
      return { source: Icon.XMarkCircle, tintColor: Color.Red };
    default:
      return { source: Icon.CircleProgress, tintColor: Color.Blue };
  }
}

export function SpeedTestMetadata({ state }: { state: RunState }) {
  const { meta, phase, scores, summary } = state;
  const pending = phase === "failed" ? "Unavailable" : "Pending";

  return (
    <Detail.Metadata>
      <Detail.Metadata.Label title="Status" text={describeStatus(state)} icon={statusIcon(state)} />
      <Detail.Metadata.Label title="Latency" text={latencyValue(state, summary.latency)} />
      <Detail.Metadata.Label title="Jitter" text={latencyValue(state, summary.jitter)} />
      <Detail.Metadata.Label title="Packet Loss" text={packetLossValue(state)} />
      <Detail.Metadata.Separator />
      {(Object.keys(EXPERIENCE_TITLES) as Experience[]).map((experience) => {
        const score = scores?.[experience];
        return (
          <Detail.Metadata.Label
            key={experience}
            title={EXPERIENCE_TITLES[experience]}
            text={score ? `${ratingStars(score.rating)}  ${RATING_TITLES[score.rating]}` : pending}
            icon={EXPERIENCE_ICONS[experience]}
          />
        );
      })}
      <Detail.Metadata.Separator />
      <Detail.Metadata.Label title="Server" text={serverLocation(state) ?? pending} icon={Icon.Globe} />
      <Detail.Metadata.Label title="Network" text={networkName(state) ?? pending} icon={Icon.Network} />
      {meta?.clientIp && <Detail.Metadata.Label title="IP Address" text={meta.clientIp} />}
      <Detail.Metadata.Separator />
      <Detail.Metadata.Link title="Methodology" text="How It's Measured" target={METHODOLOGY_URL} />
    </Detail.Metadata>
  );
}
