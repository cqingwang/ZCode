import assert from "node:assert/strict";
import test from "node:test";

import { defaultBranchRefs } from "../affected-unit-test-baseline.mjs";

test("default branch candidates cover every remote and exclude the current local branch", () => {
  assert.deepEqual(
    defaultBranchRefs({
      originHead: "origin/main",
      remotes: ["origin", "offical"],
      currentBranch: "release/deploy",
    }),
    [
      "origin/staging",
      "origin/main",
      "origin/master",
      "offical/staging",
      "offical/main",
      "offical/master",
      "staging",
      "main",
      "master",
    ],
  );
  assert.deepEqual(
    defaultBranchRefs({
      originHead: "origin/main",
      remotes: ["origin"],
      currentBranch: "main",
    }),
    ["origin/staging", "origin/main", "origin/master", "staging", "master"],
  );
});
