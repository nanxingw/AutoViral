// A7 (PRD-0010) — TextAssetRow: a content snippet card for the TEXT group.
// It shows the first ~200 chars of the file (mono, 3-line clamp) + an extension
// badge so a creator can tell files apart WITHOUT opening each one. When the
// snippet can't be fetched it degrades to a filename-only card. We mock the
// content hook so the row's own wiring is isolated (mirrors AudioAssetRow).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TextAssetRow } from "./TextAssetRow";
import type { AssetItem } from "@/queries/assets";

let snippetState: {
  text: string | null;
  truncated: boolean;
  failed: boolean;
  loading: boolean;
} = { text: "line one\nline two\nline three\nline four", truncated: true, failed: false, loading: false };

vi.mock("../../hooks/useAssetText", () => ({
  useAssetText: () => snippetState,
  SNIPPET_MAX_CHARS: 200,
}));

const TEXT: AssetItem = {
  path: "assets/text/publish-text.md",
  url: "/api/works/w1/assets/text/publish-text.md",
  kind: "text",
  ext: "md",
  name: "publish-text.md",
};

beforeEach(() => {
  snippetState = {
    text: "line one\nline two\nline three\nline four",
    truncated: true,
    failed: false,
    loading: false,
  };
});

describe("TextAssetRow", () => {
  it("renders the fetched snippet body", () => {
    render(<TextAssetRow item={TEXT} index={0} onOpen={() => {}} />);
    const snippet = screen.getByTestId("text-snippet");
    expect(snippet.textContent).toContain("line one");
    expect(snippet.textContent).toContain("line four");
  });

  it("clamps the snippet body to 3 lines", () => {
    render(<TextAssetRow item={TEXT} index={0} onOpen={() => {}} />);
    const snippet = screen.getByTestId("text-snippet");
    // happy-dom keeps the camelCase vendor key on the style object even though
    // it drops -webkit-* from the serialized attribute string.
    expect((snippet.style as unknown as Record<string, string>).WebkitLineClamp).toBe("3");
  });

  it("shows the extension badge and filename", () => {
    render(<TextAssetRow item={TEXT} index={0} onOpen={() => {}} />);
    expect(screen.getByText("MD")).toBeInTheDocument();
    expect(screen.getByText("publish-text.md")).toBeInTheDocument();
  });

  it("degrades to a filename-only card when the content fetch fails", () => {
    snippetState = { text: null, truncated: false, failed: true, loading: false };
    render(<TextAssetRow item={TEXT} index={0} onOpen={() => {}} />);
    // Filename stays visible; the snippet body must be gone.
    expect(screen.getByText("publish-text.md")).toBeInTheDocument();
    expect(screen.queryByTestId("text-snippet")).toBeNull();
  });

  it("clicking the card opens the preview", () => {
    const onOpen = vi.fn();
    render(<TextAssetRow item={TEXT} index={0} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole("button", { name: /preview publish-text\.md/i }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("keeps the delete affordance without also opening the preview", () => {
    const onOpen = vi.fn();
    const onDelete = vi.fn();
    render(
      <TextAssetRow
        item={TEXT}
        index={0}
        onOpen={onOpen}
        onDelete={onDelete}
        deleteLabel="Delete asset"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /delete asset/i }));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
  });
});
