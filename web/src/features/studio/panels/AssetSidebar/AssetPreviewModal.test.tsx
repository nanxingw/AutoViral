// A7 (PRD-0010) — AssetPreviewModal text branch: the old dead "no inline
// preview" + open-in-tab card is upgraded to a full-text <pre> so a creator
// can read the whole document in place. Non-text kinds are unchanged. We mock
// the content hook so the text branch renders deterministically.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { AssetPreviewModal } from "./AssetPreviewModal";
import { useLocaleStore } from "@/i18n/store";
import type { AssetItem } from "@/queries/assets";

let textState: {
  text: string | null;
  truncated: boolean;
  failed: boolean;
  loading: boolean;
} = { text: "FULL DOCUMENT BODY\nsecond line", truncated: false, failed: false, loading: false };

vi.mock("../../hooks/useAssetText", () => ({
  useAssetText: () => textState,
  FULL_TEXT_MAX_CHARS: 200_000,
  SNIPPET_MAX_CHARS: 200,
}));

const TEXT: AssetItem = {
  path: "assets/text/publish-text.md",
  url: "/api/works/w1/assets/text/publish-text.md",
  kind: "text",
  ext: "md",
  name: "publish-text.md",
};

const IMAGE: AssetItem = {
  path: "assets/images/cover.png",
  url: "/api/works/w1/assets/images/cover.png",
  kind: "image",
  ext: "png",
  name: "cover.png",
};

beforeEach(() => {
  textState = {
    text: "FULL DOCUMENT BODY\nsecond line",
    truncated: false,
    failed: false,
    loading: false,
  };
  useLocaleStore.setState({ locale: "en" });
});

describe("AssetPreviewModal — text branch", () => {
  it("renders the full text body in a <pre>", () => {
    render(<AssetPreviewModal asset={TEXT} onClose={() => {}} />);
    const pre = screen.getByTestId("asset-text-full");
    expect(pre.tagName).toBe("PRE");
    expect(pre.textContent).toContain("FULL DOCUMENT BODY");
    expect(pre.textContent).toContain("second line");
  });

  it("falls back to the open-in-tab card when the fetch fails", () => {
    textState = { text: null, truncated: false, failed: true, loading: false };
    render(<AssetPreviewModal asset={TEXT} onClose={() => {}} />);
    expect(screen.queryByTestId("asset-text-full")).toBeNull();
    expect(screen.getByRole("link", { name: /open in new tab/i })).toBeInTheDocument();
  });

  it("does not render the text <pre> for an image asset", () => {
    // createPortal mounts the modal into document.body, not the render root.
    render(<AssetPreviewModal asset={IMAGE} onClose={() => {}} />);
    expect(screen.queryByTestId("asset-text-full")).toBeNull();
    expect(document.body.querySelector("img")).not.toBeNull();
  });
});
