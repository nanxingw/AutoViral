import "@testing-library/jest-dom/vitest";
import { afterAll, afterEach, beforeAll } from "vitest";
import { mswServer } from "./msw";
import {
  installAudioContextMock,
  installCanvasMocks,
  mockHTMLMediaElement,
} from "./dom-mocks";

// Force the i18n store to start in English so existing
// screen.getByText("Headline font") matchers keep working without per-test
// locale fiddling. Production users see Chinese (the store's runtime default).
(globalThis as { __AUTOVIRAL_LOCALE__?: "en" | "zh" }).__AUTOVIRAL_LOCALE__ = "en";

installCanvasMocks();
installAudioContextMock();
mockHTMLMediaElement();

beforeAll(() => mswServer.listen({ onUnhandledRequest: "error" }));
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());
