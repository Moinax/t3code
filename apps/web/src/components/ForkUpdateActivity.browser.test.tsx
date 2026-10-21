import { expect, it, vi } from "vite-plus/test";
import { act, render, type Screen } from "../../test/render";
import { ForkUpdateActivity } from "./ForkUpdateActivity";

const CLIENT_HEIGHT = 200;

/**
 * Gives every `<pre>` the scroll geometry a laid-out viewport would have, for
 * one test: the browser gives an unstyled element none, and the component
 * follows output by comparing the three against each other.
 */
function stubViewportMetrics() {
  const metrics = { scrollHeight: 1000, scrollTop: 0 };
  Object.defineProperties(HTMLPreElement.prototype, {
    clientHeight: { configurable: true, get: () => CLIENT_HEIGHT },
    scrollHeight: { configurable: true, get: () => metrics.scrollHeight },
    scrollTop: {
      configurable: true,
      get: () => metrics.scrollTop,
      set: (value: number) => {
        metrics.scrollTop = Math.min(value, metrics.scrollHeight - CLIENT_HEIGHT);
      },
    },
  });
  return {
    metrics,
    [Symbol.dispose]() {
      for (const key of ["clientHeight", "scrollHeight", "scrollTop"])
        Reflect.deleteProperty(HTMLPreElement.prototype, key);
    },
  };
}

const activity = (log: string, running: boolean) => (
  <ForkUpdateActivity log={log} running={running} defaultOpen />
);

function viewport(screen: Screen) {
  const element = screen.container.querySelector("pre");
  if (!(element instanceof HTMLPreElement)) throw new Error("Missing update activity viewport");
  return element;
}

function button(screen: Screen, label: string) {
  const result = [...screen.container.querySelectorAll<HTMLButtonElement>("button")].find(
    (element) => element.textContent?.includes(label),
  );
  if (!result) throw new Error(`Missing button: ${label}`);
  return result;
}

it("follows new output, preserves the reader's position, and resumes on demand", async () => {
  using viewportMetrics = stubViewportMetrics();
  const { metrics } = viewportMetrics;
  await using screen = await render(activity("first", true));
  expect(metrics.scrollTop).toBe(800);

  metrics.scrollHeight = 1200;
  await screen.rerender(activity("second", true));
  expect(metrics.scrollTop).toBe(1000);

  viewport(screen).scrollTop = 100;
  await act(() => viewport(screen).dispatchEvent(new Event("scroll", { bubbles: true })));
  metrics.scrollHeight = 1400;
  await screen.rerender(activity("third", true));
  expect(metrics.scrollTop).toBe(100);

  await act(() => button(screen, "Jump to latest").click());
  expect(metrics.scrollTop).toBe(1200);
  metrics.scrollHeight = 1600;
  await screen.rerender(activity("finished", false));
  expect(metrics.scrollTop).toBe(1400);
});

it("copies readable text from colored output", async () => {
  using _viewportMetrics = stubViewportMetrics();
  const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
  using _clipboard = { [Symbol.dispose]: () => void writeText.mockRestore() };
  await using screen = await render(activity("\u001b[32mMigration complete\u001b[39m\n", true));
  await act(() => button(screen, "Copy log").click());
  expect(writeText).toHaveBeenCalledWith("Migration complete\n");
});
