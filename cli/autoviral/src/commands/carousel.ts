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
  //   --x N --y N --w N --h N [kind-specific flags]
  //   Adds (or replaces, if --id matches) a layer on the slide. Prints the
  //   layer id. The full per-kind field list is in `autoviral docs
  //   carousel/02-schema`.
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
    // box is required by LayerSchema for every kind; default to a sensible
    // full-bleed-ish rect so a minimal invocation still validates. Callers
    // override with --x/--y/--w/--h. rotation defaults server-side.
    const box = {
      x: numOr(opts["--x"], 80),
      y: numOr(opts["--y"], 80),
      w: numOr(opts["--w"], 920),
      h: numOr(opts["--h"], 200),
      ...(opts["--rotation"] !== undefined
        ? { rotation: Number(opts["--rotation"]) }
        : {}),
    };
    const layer: Record<string, unknown> = { kind, box };
    if (opts["--id"] !== undefined) layer.id = opts["--id"];

    if (kind === "text") {
      if (opts["--text"] === undefined) {
        process.stderr.write("autoviral carousel set-layer --kind text: --text required\n");
        process.exit(4);
      }
      layer.text = opts["--text"];
      const style: Record<string, unknown> = {};
      if (opts["--font"] !== undefined) style.font = opts["--font"];
      if (opts["--size"] !== undefined) style.size = Number(opts["--size"]);
      if (opts["--weight"] !== undefined) style.weight = Number(opts["--weight"]);
      if (opts["--color"] !== undefined) style.color = opts["--color"];
      if (opts["--align"] !== undefined) style.align = opts["--align"];
      if (Object.keys(style).length > 0) layer.style = style;
    } else if (kind === "image" || kind === "sticker") {
      if (opts["--src"] === undefined) {
        process.stderr.write(`autoviral carousel set-layer --kind ${kind}: --src required\n`);
        process.exit(4);
      }
      layer.src = opts["--src"];
    } else if (kind === "shape") {
      if (opts["--shape"] === undefined) {
        process.stderr.write(
          "autoviral carousel set-layer --kind shape: --shape required (rect|circle|line)\n",
        );
        process.exit(4);
      }
      layer.shape = opts["--shape"];
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

function numOr(v: string | undefined, fallback: number): number {
  return v === undefined ? fallback : Number(v);
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
