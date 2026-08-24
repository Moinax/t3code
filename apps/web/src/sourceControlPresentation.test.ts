import { describe, expect, it } from "vite-plus/test";

import { ForgejoIcon } from "./components/Icons";
import {
  getSourceControlPresentation,
  getSourceControlPresentationForKind,
} from "./sourceControlPresentation";

describe("Forgejo source control presentation", () => {
  it("uses the Forgejo icon and pull request terminology", () => {
    const presentation = getSourceControlPresentation({
      kind: "forgejo",
      name: "Codeberg",
      baseUrl: "https://codeberg.org",
    });

    expect(presentation.providerName).toBe("Codeberg");
    expect(presentation.terminology).toEqual({
      shortLabel: "PR",
      singular: "pull request",
    });
    expect(presentation.Icon).toBe(ForgejoIcon);
    expect(getSourceControlPresentationForKind("forgejo").Icon).toBe(ForgejoIcon);
  });
});
