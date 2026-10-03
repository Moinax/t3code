import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { ForkUpdateActivity } from "./ForkUpdateActivity";
import { Button } from "./ui/button";

let renderer: ReactTestRenderer;
beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterEach(async () => {
  if (renderer) await act(() => renderer.unmount());
  vi.unstubAllGlobals();
});

it("follows new output, preserves the reader's position, and resumes on demand", async () => {
  let scrollTop = 0;
  const viewport = {
    scrollHeight: 1000,
    clientHeight: 200,
    get scrollTop() {
      return scrollTop;
    },
    set scrollTop(value: number) {
      scrollTop = Math.min(value, this.scrollHeight - this.clientHeight);
    },
  };
  await act(() => {
    renderer = create(<ForkUpdateActivity log="first" running defaultOpen />, {
      createNodeMock: (element) => (element.type === "pre" ? viewport : null),
    });
  });
  expect(viewport.scrollTop).toBe(800);

  viewport.scrollHeight = 1200;
  await act(() => renderer.update(<ForkUpdateActivity log="second" running defaultOpen />));
  expect(viewport.scrollTop).toBe(1000);

  viewport.scrollTop = 100;
  await act(() => renderer.root.findByType("pre").props.onScroll({ currentTarget: viewport }));
  viewport.scrollHeight = 1400;
  await act(() => renderer.update(<ForkUpdateActivity log="third" running defaultOpen />));
  expect(viewport.scrollTop).toBe(100);

  await act(() => {
    renderer.root
      .findAllByType(Button)
      .find((button) => button.props.children.includes("Jump to latest"))!
      .props.onClick();
  });
  expect(viewport.scrollTop).toBe(1200);
  viewport.scrollHeight = 1600;
  await act(() =>
    renderer.update(<ForkUpdateActivity log="finished" running={false} defaultOpen />),
  );
  expect(viewport.scrollTop).toBe(1400);
});

it("copies readable text from colored output", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("window", {});
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  await act(() => {
    renderer = create(
      <ForkUpdateActivity log={"\u001b[32mMigration complete\u001b[39m\n"} running defaultOpen />,
    );
  });
  await act(() => {
    renderer.root
      .findAllByType(Button)
      .find((button) => button.props.children.includes("Copy log"))!
      .props.onClick();
  });
  expect(writeText).toHaveBeenCalledWith("Migration complete\n");
});
