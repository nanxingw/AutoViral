import "@testing-library/jest-dom/vitest";
import { afterAll, afterEach, beforeAll } from "vitest";
import { mswServer } from "./msw";
import {
  installAudioContextMock,
  installCanvasMocks,
  mockHTMLMediaElement,
} from "./dom-mocks";

installCanvasMocks();
installAudioContextMock();
mockHTMLMediaElement();

beforeAll(() => mswServer.listen({ onUnhandledRequest: "error" }));
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());
