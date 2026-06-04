// `autoviral carousel add-slide | set-layer` — carousel.yaml write surface.
//
// The carousel analogue of `clip add|set`. Both sub-verbs round-trip through
// the bridge so the canonical disk state is always the server's (no local
// edit-then-push). The server validates each mutation against the SHARED
// CarouselSchema before atomic-renaming carousel.yaml — invalid input leaves
// the on-disk carousel UNTOUCHED and exits 4 (validation error). This closes
// PRD-0002's only high-severity gap: the agent no longer blind-writes
// carousel.yaml. Read `autoviral docs carousel/02-schema` for the full shape.

import { bridgeRequest, readContext } from "../client.js";

export async function carouselCommand(args: string[]): Promise<void> {
  const [sub, ...rest] = args;
  const ctx = readContext();

  // carousel add-slide [--at N] [--bg-type gradient|image|solid] [--bg-value V]
  //   Appends a slide (empty gradient bg by default), optionally at index --at.
  //   Prints the new slide id to stdout.
  if (sub === "add-slide") {
    const opts = parseFlags(rest);
    const body: Record<string, unknown> = {};
    if (opts["--at"] !== undefined) body.at = Number(opts["--at"]);
    const bgType = opts["--bg-type"];
    if (bgType !== undefined) {
      if (opts["--bg-value"] === undefined) {
        process.stderr.write(
          "autoviral carousel add-slide: --bg-type requires --bg-value\n",
        );
        process.exit(4);
      }
      body.bg = { type: bgType, value: opts["--bg-value"] };
    }
    const result = await bridgeRequest<{ id: string }>(
      ctx,
      "POST",
      "/carousel/slide",
      body,
    );
    process.stdout.write(`${result.id}\n`);
    return;
  }

  // carousel set-layer <slideId> --kind text|image|shape|sticker [--id L] \
  //   [--x N --y N --w N --h N] [kind-specific flags]
  //   Adds (new --id / no --id) OR PATCHES (existing --id) a layer on the
  //   slide. A patch DEEP-MERGES server-side: only the flags you pass are
  //   overridden, everything else on that layer is preserved (the carousel
  //   twin of `clip set`). So `set-layer s1 --id t_x --kind text --text "new"`
  //   keeps t_x's box / font / size / color / align untouched. Prints the
  //   layer id. Full per-kind field list: `autoviral docs carousel/02-schema`.
  if (sub === "set-layer") {
    const slideId = rest[0];
    if (!slideId) {
      process.stderr.write(
        "usage: autoviral carousel set-layer <slideId> --kind <text|image|shape|sticker> [flags]\n",
      );
      process.exit(4);
    }
    const opts = parseFlags(rest.slice(1));
    const kind = opts["--kind"];
    if (!kind) {
      process.stderr.write(
        "autoviral carousel set-layer: --kind required (text|image|shape|sticker)\n",
      );
      process.exit(4);
    }
    const hasId = opts["--id"] !== undefined && opts["--id"] !== "";

    // box is REQUIRED by LayerSchema for a NEW layer (x/y/w/h have no schema
    // default). For a CREATE we default to a sensible full-bleed-ish rect so a
    // minimal invocation still validates. For a PATCH (--id given) we send ONLY
    // the box leaves the caller explicitly passed, so the server's deep-merge
    // preserves the existing box's other coordinates instead of resetting them.
    const box: Record<string, number> = {};
    if (opts["--x"] !== undefined) box.x = Number(opts["--x"]);
    if (opts["--y"] !== undefined) box.y = Number(opts["--y"]);
    if (opts["--w"] !== undefined) box.w = Number(opts["--w"]);
    if (opts["--h"] !== undefined) box.h = Number(opts["--h"]);
    if (opts["--rotation"] !== undefined) box.rotation = Number(opts["--rotation"]);
    if (!hasId) {
      // CREATE — fill any missing box leaf with the default rect.
      if (box.x === undefined) box.x = 80;
      if (box.y === undefined) box.y = 80;
      if (box.w === undefined) box.w = 920;
      if (box.h === undefined) box.h = 200;
    }

    const layer: Record<string, unknown> = { kind };
    if (hasId) layer.id = opts["--id"];
    // Only attach `box` if it carries at least one leaf — an empty box on a
    // patch would otherwise smuggle an `{}` that fails LayerSchema's required
    // box on the merged result (it can't, since the existing box survives) but
    // is needless noise; on a create `box` is always populated above.
    if (Object.keys(box).length > 0) layer.box = box;

    if (kind === "text") {
      // On a CREATE, --text is required (a text layer must have a body). On a
      // PATCH (--id) it's optional — an agent may want to restyle without
      // retyping the copy, and the existing text survives the deep-merge.
      if (opts["--text"] === undefined && !hasId) {
        process.stderr.write("autoviral carousel set-layer --kind text: --text required\n");
        process.exit(4);
      }
      if (opts["--text"] !== undefined) layer.text = opts["--text"];
      const style: Record<string, unknown> = {};
      if (opts["--font"] !== undefined) style.font = opts["--font"];
      if (opts["--size"] !== undefined) style.size = Number(opts["--size"]);
      if (opts["--weight"] !== undefined) style.weight = Number(opts["--weight"]);
      if (opts["--italic"] !== undefined) style.italic = parseBool(opts["--italic"]);
      if (opts["--color"] !== undefined) style.color = opts["--color"];
      if (opts["--align"] !== undefined) style.align = opts["--align"];
      if (opts["--tracking"] !== undefined) style.tracking = Number(opts["--tracking"]);
      if (Object.keys(style).length > 0) layer.style = style;
    } else if (kind === "image" || kind === "sticker") {
      // --src is required to CREATE an image/sticker; on a PATCH it survives.
      if (opts["--src"] === undefined && !hasId) {
        process.stderr.write(`autoviral carousel set-layer --kind ${kind}: --src required\n`);
        process.exit(4);
      }
      if (opts["--src"] !== undefined) layer.src = opts["--src"];
    } else if (kind === "shape") {
      // --shape is required to CREATE a shape; on a PATCH it survives.
      if (opts["--shape"] === undefined && !hasId) {
        process.stderr.write(
          "autoviral carousel set-layer --kind shape: --shape required (rect|circle|line)\n",
        );
        process.exit(4);
      }
      if (opts["--shape"] !== undefined) layer.shape = opts["--shape"];
      if (opts["--fill"] !== undefined) layer.fill = opts["--fill"];
      if (opts["--stroke"] !== undefined) layer.stroke = opts["--stroke"];
      if (opts["--stroke-width"] !== undefined)
        layer.strokeWidth = Number(opts["--stroke-width"]);
    }

    const result = await bridgeRequest<{ id: string }>(
      ctx,
      "POST",
      `/carousel/slide/${encodeURIComponent(slideId)}/layer`,
      layer,
    );
    process.stdout.write(`${result.id}\n`);
    return;
  }

  process.stderr.write(`autoviral carousel: unknown subcommand "${sub ?? ""}"\n`);
  process.exit(127);
}

// `--italic` takes an explicit `true|false` (parseFlags always pairs a flag
// with the next token). Anything other than "false"/"0"/"no" is truthy so a
// bare `--italic true` reads naturally; "false"/"0"/"no" turn italic off.
function parseBool(v: string | undefined): boolean {
  if (v === undefined) return true;
  return !["false", "0", "no", "off"].includes(v.toLowerCase());
}

function parseFlags(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k.startsWith("--")) {
      out[k] = argv[i + 1];
      i++;
    }
  }
  return out;
}
