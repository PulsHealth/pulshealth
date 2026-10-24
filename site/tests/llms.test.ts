import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { renderMachineMarkdown } from "../src/lib/llms";

const routes = { "docs/setup.md": "/docs/setup/", "server/README.md": "/docs/server/" };

describe("AI-readable documentation", () => {
  test("resolves links from the source document rather than the published URL", () => {
    const source = "[Setup](setup.md) [Server](../server/README.md#backups) [Script](../scripts/bootstrap.sh)";
    assert.equal(renderMachineMarkdown(source, "docs/ai.md", routes),
      "[Setup](https://pulshealth.com/docs/setup/) [Server](https://pulshealth.com/docs/server/#backups) [Script](https://github.com/PulsHealth/pulshealth/blob/main/scripts/bootstrap.sh)",
    );
  });

  test("keeps commands and literal Markdown examples untouched", () => {
    const source = "```sh\n[example](setup.md)\n```\n`[literal](setup.md)` and [Setup](setup.md)\n~~~~md\n```\n[example](setup.md)\n~~~~";
    assert.equal(renderMachineMarkdown(source, "docs/ai.md", routes), source.replace("and [Setup](setup.md)", "and [Setup](https://pulshealth.com/docs/setup/)"));
  });

  test("supports reference links, site paths, anchors and external URLs", () => {
    const source = "[setup]: setup.md\n[Site](/server/) [Part](#part) [External](https://example.com/guide)";
    assert.equal(renderMachineMarkdown(source, "docs/ai.md", routes),
      "[setup]: https://pulshealth.com/docs/setup/\n[Site](https://pulshealth.com/server/) [Part](#part) [External](https://example.com/guide)",
    );
  });
});
