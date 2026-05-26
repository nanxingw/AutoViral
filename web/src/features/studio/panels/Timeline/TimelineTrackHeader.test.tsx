import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { TimelineTrackHeader } from "./TimelineTrackHeader";
import { useComposition } from "../../store";
import { makeEmptyComposition, type VideoClip, type Track } from "../../types";

/* Phase F (issue #33) — TimelineTrackHeader contract tests.

   We seed a real store (not a mock) because the component reads through
   useComposition selectors. We then spy on the store's actions by replacing
   them with vi.fn() copies *before* each test so we can assert call shapes
   without rebuilding the whole zustand instance. */

const baseTransform = { scale: 1, x: 0, y: 0, rotation: 0 };
const baseFilters = { brightness: 0, contrast: 0, saturation: 0 };

function seed() {
  const c = makeEmptyComposition({ workId: "w-test-33" });
  // Drop a clip into the video lane so we exercise the "has-clips" remove
  // confirm path on tests that target the video track.
  const clip: VideoClip = {
    id: "clip-1",
    kind: "video",
    src: "/x.mp4",
    in: 0,
    out: 2,
    trackOffset: 0,
    transforms: baseTransform,
    filters: baseFilters,
  };
  const videoLane = c.tracks.find((t) => t.kind === "video")!;
  videoLane.clips.push(clip);
  useComposition.setState({ comp: c });
  return c;
}

function getTrack(kind: Track["kind"]): Track {
  const comp = useComposition.getState().comp!;
  return comp.tracks.find((t) => t.kind === kind)!;
}

beforeEach(() => {
  seed();
});

describe("<TimelineTrackHeader /> — menu entries", () => {
  it("opens the menu via the ⋯ button click and shows all action items", async () => {
    const user = userEvent.setup();
    const track = getTrack("audio");
    render(<TimelineTrackHeader track={track} fallbackLabel="Music" height={56} />);

    await user.click(screen.getByRole("button", { name: /track options/i }));

    const menu = screen.getByRole("menu", { name: /track options/i });
    expect(within(menu).getByRole("menuitem", { name: /add lane above/i })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: /add lane below/i })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: /rename/i })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: /remove lane/i })).toBeInTheDocument();
    // Audio lane → no "Set language" item.
    expect(within(menu).queryByRole("menuitem", { name: /set language/i })).toBeNull();
  });

  it("right-click anywhere on the header cell also opens the menu", async () => {
    const user = userEvent.setup();
    const track = getTrack("audio");
    const { container } = render(
      <TimelineTrackHeader track={track} fallbackLabel="Music" height={56} />,
    );
    const root = container.firstElementChild as HTMLElement;
    await user.pointer({ keys: "[MouseRight>]", target: root });
    expect(screen.getByRole("menu", { name: /track options/i })).toBeInTheDocument();
  });

  it("exposes 'Set language' only on text/subtitle lanes", async () => {
    const user = userEvent.setup();
    const text = getTrack("text");
    render(<TimelineTrackHeader track={text} fallbackLabel="Subs" height={44} />);
    await user.click(screen.getByRole("button", { name: /track options/i }));
    expect(screen.getByRole("menuitem", { name: /set language/i })).toBeInTheDocument();
  });
});

describe("<TimelineTrackHeader /> — action wiring", () => {
  it("Add lane above → addTrack(kind, afterTrackId = track-above.id)", async () => {
    const user = userEvent.setup();
    // Audio lane (A1) sits below the video lane in default order, so the
    // track above is the video lane. addTrack should be called with the
    // *audio* kind (we clone the current row's kind) and the video lane's
    // id as the anchor.
    const audio = getTrack("audio");
    const video = getTrack("video");
    const spy = vi.spyOn(useComposition.getState(), "addTrack");
    // The spy patches the snapshot — but selectors pull from the live store.
    // For zustand we need to setState a new action ref so the component
    // picks up our spy. Easiest: replace addTrack directly on the state.
    useComposition.setState({ addTrack: spy as never });

    render(<TimelineTrackHeader track={audio} fallbackLabel="Music" height={56} />);
    await user.click(screen.getByRole("button", { name: /track options/i }));
    await user.click(screen.getByRole("menuitem", { name: /add lane above/i }));

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith("audio", { afterTrackId: video.id });
  });

  it("Add lane below → addTrack(kind, afterTrackId = this.id)", async () => {
    const user = userEvent.setup();
    const audio = getTrack("audio");
    const spy = vi.fn(useComposition.getState().addTrack);
    useComposition.setState({ addTrack: spy as never });

    render(<TimelineTrackHeader track={audio} fallbackLabel="Music" height={56} />);
    await user.click(screen.getByRole("button", { name: /track options/i }));
    await user.click(screen.getByRole("menuitem", { name: /add lane below/i }));

    expect(spy).toHaveBeenCalledWith("audio", { afterTrackId: audio.id });
  });

  it("Rename → enter input, type, Enter → renameTrack(id, newLabel)", async () => {
    const user = userEvent.setup();
    const track = getTrack("audio");
    const spy = vi.fn(useComposition.getState().renameTrack);
    useComposition.setState({ renameTrack: spy });

    render(<TimelineTrackHeader track={track} fallbackLabel="Music" height={56} />);
    await user.click(screen.getByRole("button", { name: /track options/i }));
    await user.click(screen.getByRole("menuitem", { name: /rename/i }));

    const input = await screen.findByRole("textbox", { name: /rename/i });
    await user.clear(input);
    await user.type(input, "Voiceover");
    await user.keyboard("{Enter}");

    expect(spy).toHaveBeenCalledWith(track.id, "Voiceover");
  });

  it("Set language → handleLanguagePick calls setTrackLanguage(id, lang)", async () => {
    const user = userEvent.setup();
    const text = getTrack("text");
    const spy = vi.fn(useComposition.getState().setTrackLanguage);
    useComposition.setState({ setTrackLanguage: spy });

    render(<TimelineTrackHeader track={text} fallbackLabel="Subs" height={44} />);
    await user.click(screen.getByRole("button", { name: /track options/i }));
    await user.click(screen.getByRole("menuitem", { name: /set language/i }));

    // Submenu reveals ZH / EN / JA / —
    const zh = await screen.findByRole("menuitem", { name: /^ZH$/ });
    await user.click(zh);

    expect(spy).toHaveBeenCalledWith(text.id, "zh");
  });

  it("Remove on empty lane → removeTrack(id) without force", async () => {
    const user = userEvent.setup();
    // Overlay lane is empty by default in makeEmptyComposition? No — default
    // composition has V1/A1/A2/CC1. We need to ensure an empty lane.
    // Add a fresh empty audio lane explicitly so we test the fast path.
    const newId = useComposition.getState().addTrack("audio");
    const empty = useComposition.getState().comp!.tracks.find((t) => t.id === newId)!;
    expect(empty.clips.length).toBe(0);

    const spy = vi.fn(useComposition.getState().removeTrack);
    useComposition.setState({ removeTrack: spy as never });

    render(<TimelineTrackHeader track={empty} fallbackLabel="Music" height={56} />);
    await user.click(screen.getByRole("button", { name: /track options/i }));
    await user.click(screen.getByRole("menuitem", { name: /remove lane/i }));

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(empty.id);
    // No confirm dialog should have been rendered.
    expect(screen.queryByTestId("track-remove-confirm-backdrop")).toBeNull();
  });

  it("Remove on non-empty lane → shows confirm, Confirm → removeTrack(id, {force:true})", async () => {
    const user = userEvent.setup();
    const video = getTrack("video"); // has clip-1 from seed()
    expect(video.clips.length).toBeGreaterThan(0);

    const spy = vi.fn(useComposition.getState().removeTrack);
    useComposition.setState({ removeTrack: spy as never });

    render(<TimelineTrackHeader track={video} fallbackLabel="Video" height={56} />);
    await user.click(screen.getByRole("button", { name: /track options/i }));
    await user.click(screen.getByRole("menuitem", { name: /remove lane/i }));

    // Confirm dialog should now be visible.
    expect(screen.getByTestId("track-remove-confirm-backdrop")).toBeInTheDocument();
    // Should NOT have called removeTrack yet — it waits for confirm.
    expect(spy).not.toHaveBeenCalled();

    await user.click(screen.getByTestId("track-remove-confirm-confirm"));
    expect(spy).toHaveBeenCalledWith(video.id, { force: true });
  });

  // #53 — the confirm copy used to promise "reversible via Undo", but Studio
  // has no undo control wired (undoTrackOp is orphaned and a global undo would
  // desync with un-snapshotted clip edits). The honest copy must NOT promise
  // recovery and MUST warn the destructive removal can't be undone.
  it("Remove confirm on a non-empty lane does NOT promise Undo, and warns it can't be undone (#53)", async () => {
    const user = userEvent.setup();
    const video = getTrack("video");
    expect(video.clips.length).toBeGreaterThan(0);

    render(<TimelineTrackHeader track={video} fallbackLabel="Video" height={56} />);
    await user.click(screen.getByRole("button", { name: /track options/i }));
    await user.click(screen.getByRole("menuitem", { name: /remove lane/i }));

    const backdrop = screen.getByTestId("track-remove-confirm-backdrop");
    expect(backdrop).toBeInTheDocument();
    expect(backdrop.textContent ?? "").toMatch(/can't be undone/i);
    expect(backdrop.textContent ?? "").not.toMatch(/reversible|via Undo/i);
  });

  it("Remove confirm — Cancel button dismisses without calling removeTrack", async () => {
    const user = userEvent.setup();
    const video = getTrack("video");
    const spy = vi.fn(useComposition.getState().removeTrack);
    useComposition.setState({ removeTrack: spy as never });

    render(<TimelineTrackHeader track={video} fallbackLabel="Video" height={56} />);
    await user.click(screen.getByRole("button", { name: /track options/i }));
    await user.click(screen.getByRole("menuitem", { name: /remove lane/i }));
    expect(screen.getByTestId("track-remove-confirm-backdrop")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(screen.queryByTestId("track-remove-confirm-backdrop")).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("<TimelineTrackHeader /> — visual state", () => {
  it("renders the track label", () => {
    const track = getTrack("audio");
    render(<TimelineTrackHeader track={track} fallbackLabel="Music" height={56} />);
    // Default seeded label is "A1"; fallback wins only when label is empty.
    expect(screen.getByText(track.label)).toBeInTheDocument();
  });

  it("mute / hide live in the menu as menuitemcheckbox entries", async () => {
    const track = getTrack("audio");
    const user = userEvent.setup();
    render(<TimelineTrackHeader track={track} fallbackLabel="Music" height={56} />);

    // Inline mute/hide buttons removed by 2026-05-25 redesign — they live
    // inside the ⋯ menu now (Notion/Linear/Resolve convention). Open menu
    // and assert both checkbox items render with aria-checked="false".
    await user.click(screen.getByRole("button", { name: /track options/i }));

    const muteItem = await screen.findByRole("menuitemcheckbox", { name: /^mute/i });
    expect(muteItem.getAttribute("aria-checked")).toBe("false");
    const hideItem = await screen.findByRole("menuitemcheckbox", { name: /hide lane/i });
    expect(hideItem.getAttribute("aria-checked")).toBe("false");
  });
});
