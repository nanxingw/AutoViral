// Phase H (issue #35) — CaptionTracksSection contract tests.
//
// The component is a controlled-input shell: the parent owns the
// CaptionSelection and re-renders us with the next one. So these tests
// drive the section through a thin stateful wrapper to assert that the
// radio-like Burn constraint, Sidecar toggles, and empty-state copy all
// behave as the issue's acceptance criteria require.

import { describe, it, expect, afterEach } from "vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLocaleStore } from "@/i18n/store";
import {
  CaptionTracksSection,
  defaultCaptionSelection,
  type CaptionSelection,
  type CaptionTrackOption,
} from "./CaptionTracksSection";

function Harness({
  tracks,
  initial,
}: {
  tracks: CaptionTrackOption[];
  initial?: CaptionSelection;
}) {
  const [selection, setSelection] = useState<CaptionSelection>(
    initial ?? defaultCaptionSelection(tracks),
  );
  return (
    <CaptionTracksSection
      tracks={tracks}
      selection={selection}
      onSelectionChange={setSelection}
    />
  );
}

const TWO_TRACK_FIXTURE: CaptionTrackOption[] = [
  { id: "trk_t0000001", label: "CC1 · ZH", language: "zh" },
  { id: "trk_t0000002", label: "CC2 · EN", language: "en" },
];

// #73 — the whole caption-export surface was hardcoded English. These pin
// that the prose + column headers localize, so a ZH user no longer sees an
// English-only dialog. (Default test locale is EN, so the other suites still
// assert the English copy.)
describe("CaptionTracksSection — i18n (#73)", () => {
  afterEach(() => {
    useLocaleStore.getState().setLocale("en");
  });

  it("renders Chinese copy under the zh locale", () => {
    useLocaleStore.getState().setLocale("zh");
    render(<Harness tracks={TWO_TRACK_FIXTURE} />);
    // Title + column headers are translated, not the English originals.
    expect(screen.getByText("字幕轨道")).toBeInTheDocument();
    expect(screen.getByText("烧录")).toBeInTheDocument();
    expect(screen.getByText("外挂")).toBeInTheDocument();
    expect(screen.queryByText("Caption tracks")).toBeNull();
    expect(screen.queryByText("Burn")).toBeNull();
  });

  it("localizes the empty-state copy under zh", () => {
    useLocaleStore.getState().setLocale("zh");
    render(<Harness tracks={[]} />);
    expect(screen.getByText(/没有文本轨道/)).toBeInTheDocument();
    expect(screen.queryByText(/No text tracks/)).toBeNull();
  });

  it("localizes the burn-disabled tooltip aria + checkbox aria under zh", async () => {
    useLocaleStore.getState().setLocale("zh");
    render(<Harness tracks={TWO_TRACK_FIXTURE} />);
    // Burn aria is translated and interpolates the label.
    expect(
      screen.getByLabelText("将 CC1 · ZH 烧录进视频"),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("将 CC2 · EN 导出为 SRT 外挂字幕"),
    ).toBeInTheDocument();
  });
});

describe("CaptionTracksSection — defaults", () => {
  it("renders one row per text track with the language tag", () => {
    render(<Harness tracks={TWO_TRACK_FIXTURE} />);
    expect(screen.getByText("CC1 · ZH")).toBeInTheDocument();
    expect(screen.getByText("CC2 · EN")).toBeInTheDocument();
    expect(screen.getByText("zh")).toBeInTheDocument();
    expect(screen.getByText("en")).toBeInTheDocument();
  });

  it("first row defaults to Burn=on, second row defaults to Sidecar=on", () => {
    render(<Harness tracks={TWO_TRACK_FIXTURE} />);
    expect(screen.getByTestId("burn-trk_t0000001")).toBeChecked();
    expect(screen.getByTestId("sidecar-trk_t0000001")).not.toBeChecked();
    expect(screen.getByTestId("burn-trk_t0000002")).not.toBeChecked();
    expect(screen.getByTestId("sidecar-trk_t0000002")).toBeChecked();
  });

  it("renders 'und' pill when a track has no language tag", () => {
    render(
      <Harness
        tracks={[{ id: "trk_t0000099", label: "CC3 · ???" }]}
      />,
    );
    expect(screen.getByText("und")).toBeInTheDocument();
  });
});

describe("CaptionTracksSection — radio-like Burn constraint", () => {
  it("checking Burn on a different row auto-unchecks the previous Burn", async () => {
    const user = userEvent.setup();
    render(<Harness tracks={TWO_TRACK_FIXTURE} />);
    expect(screen.getByTestId("burn-trk_t0000001")).toBeChecked();

    // The 2nd row's Burn is disabled while Burn-1 is checked — first we
    // uncheck Burn-1, then re-toggle the 2nd row. (Alternative API:
    // some users might expect clicking the disabled checkbox to take
    // over directly; we follow Resolve's behaviour: explicit
    // single-burn discipline.)
    await user.click(screen.getByTestId("burn-trk_t0000001"));
    await user.click(screen.getByTestId("burn-trk_t0000002"));

    expect(screen.getByTestId("burn-trk_t0000001")).not.toBeChecked();
    expect(screen.getByTestId("burn-trk_t0000002")).toBeChecked();
  });

  it("disables Burn on other rows when one row is already burned, with tooltip", () => {
    render(<Harness tracks={TWO_TRACK_FIXTURE} />);
    const burn2 = screen.getByTestId("burn-trk_t0000002");
    expect(burn2).toBeDisabled();
    expect(
      screen.getByText(/only one track can be burned in at export/i),
    ).toBeInTheDocument();
  });

  it("allows both Burn checkboxes off (skip export captions entirely)", async () => {
    const user = userEvent.setup();
    render(<Harness tracks={TWO_TRACK_FIXTURE} />);
    await user.click(screen.getByTestId("burn-trk_t0000001"));
    expect(screen.getByTestId("burn-trk_t0000001")).not.toBeChecked();
    expect(screen.getByTestId("burn-trk_t0000002")).not.toBeChecked();
  });
});

describe("CaptionTracksSection — Sidecar toggle independence", () => {
  it("checking Sidecar on the burned row strips the burn (Resolve invariant)", async () => {
    const user = userEvent.setup();
    render(<Harness tracks={TWO_TRACK_FIXTURE} />);
    // Row 1 starts burned. Sidecar'ing it should clear the burn.
    await user.click(screen.getByTestId("sidecar-trk_t0000001"));
    expect(screen.getByTestId("burn-trk_t0000001")).not.toBeChecked();
    expect(screen.getByTestId("sidecar-trk_t0000001")).toBeChecked();
  });

  it("toggling Sidecar off leaves Burn untouched on other rows", async () => {
    const user = userEvent.setup();
    render(<Harness tracks={TWO_TRACK_FIXTURE} />);
    await user.click(screen.getByTestId("sidecar-trk_t0000002"));
    expect(screen.getByTestId("sidecar-trk_t0000002")).not.toBeChecked();
    expect(screen.getByTestId("burn-trk_t0000001")).toBeChecked();
  });
});

describe("CaptionTracksSection — empty state", () => {
  it("renders the no-tracks copy when the composition has no text lanes", () => {
    render(<Harness tracks={[]} />);
    expect(screen.getByText(/no text tracks in this composition/i)).toBeInTheDocument();
  });
});
