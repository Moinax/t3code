import { expect, it } from "@effect/vitest";
import * as Context from "effect/Context";
import { Tool } from "effect/unstable/ai";

import { ThreadToolkit } from "./tools.ts";

it("exports a provider-compatible object schema with described parameters", () => {
  for (const tool of Object.values(ThreadToolkit.tools)) {
    const schema = Tool.getJsonSchema(tool) as {
      readonly type?: unknown;
      readonly properties?: Readonly<Record<string, unknown>>;
      readonly anyOf?: unknown;
      readonly oneOf?: unknown;
    };
    expect(
      tool.description?.length ?? 0,
      `${tool.name} should have a useful description`,
    ).toBeGreaterThan(40);
    expect(schema.type, `${tool.name} must export a top-level object schema`).toBe("object");
    expect(schema.anyOf, `${tool.name} must not export a root anyOf`).toBeUndefined();
    expect(schema.oneOf, `${tool.name} must not export a root oneOf`).toBeUndefined();
    for (const [field, fieldSchema] of Object.entries(schema.properties ?? {})) {
      expect(
        (fieldSchema as { readonly description?: unknown }).description,
        `${tool.name}.${field} should explain what data the agent must pass`,
      ).toEqual(expect.any(String));
    }
  }
});

it("advertises the rename as a writing, non-browsing, idempotent tool", () => {
  const tool = ThreadToolkit.tools.thread_set_title;
  expect(Context.get(tool.annotations, Tool.Readonly)).toBe(false);
  expect(Context.get(tool.annotations, Tool.Destructive)).toBe(false);
  expect(Context.get(tool.annotations, Tool.OpenWorld)).toBe(false);
  expect(Context.get(tool.annotations, Tool.Idempotent)).toBe(true);
});
