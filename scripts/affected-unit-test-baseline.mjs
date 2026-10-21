import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function gitOut(cwd, args) {
  try {
    const { stdout } = await execFileAsync("git", args, { cwd });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/**
 * 默认分支候选只描述“可能的基线”，不预设某个远端。
 *
 * Bug 原因：仓库可能同时存在 origin（个人 fork）与 offical（官方源），两者历史
 * 并不共享同一个最新提交。固定回退 origin/main 会把官方已合入的文件误判成本分支
 * 新增；固定回退 origin/staging 在没有该分支时又直接失败。
 */
export function defaultBranchRefs({ originHead, remotes = [], currentBranch = null } = {}) {
  const refs = [];
  for (const remote of remotes) {
    refs.push(`${remote}/staging`, `${remote}/main`, `${remote}/master`);
  }
  if (originHead) refs.push(originHead);
  // 本地分支只在没有远端候选时兜底；当前分支本身不能作为自己的比较基线。
  for (const local of ["staging", "main", "master"]) {
    if (local !== currentBranch) refs.push(local);
  }
  return [...new Set(refs.filter(Boolean))];
}

function compareScore(a, b) {
  return a.ahead - b.ahead || a.ancestor - b.ancestor || a.index - b.index;
}

/**
 * 在所有默认分支候选中选择与 HEAD 共同祖先最近的一个。
 *
 * 先比较 `mergeBase..HEAD` 的提交数，再优先选择本身就是 HEAD 祖先的分支，
 * 最后按候选顺序稳定决胜。这样：
 * - 基于 offical/main 的分支不会被落后的 origin/main 拉回旧基线；
 * - 基于 origin/main 的分支也不会被更远的官方分支误选；
 * - 不存在的 origin/master 等候选自然忽略。
 */
export async function selectClosestDefaultBranch(cwd, { head = "HEAD", candidates } = {}) {
  const headSha = await gitOut(cwd, ["rev-parse", "--verify", "--quiet", `${head}^{commit}`]);
  if (!headSha) return null;
  const configuredRemotes =
    (await gitOut(cwd, ["remote"]))
      ?.split(/\r?\n/u)
      .map((remote) => remote.trim())
      .filter(Boolean) ?? [];
  // 测试夹具与浅克隆可能只有 refs/remotes/* 而没有 remote 配置；
  // 分支候选仍应覆盖这些已 fetch 的远端。
  const refRemotes =
    (await gitOut(cwd, ["for-each-ref", "--format=%(refname:short)", "refs/remotes"]))
      ?.split(/\r?\n/u)
      .map((ref) => ref.split("/")[0])
      .filter((remote) => remote && remote !== "HEAD") ?? [];
  const remotes = [...new Set([...configuredRemotes, ...refRemotes])];
  const originHead = await gitOut(cwd, [
    "symbolic-ref",
    "--quiet",
    "--short",
    "refs/remotes/origin/HEAD",
  ]);
  const currentBranch = await gitOut(cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  const refs =
    candidates ?? defaultBranchRefs({ originHead, remotes, currentBranch });
  let best = null;
  for (const [index, ref] of refs.entries()) {
    const sha = await gitOut(cwd, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
    if (!sha) continue;
    const mergeBase = await gitOut(cwd, ["merge-base", headSha, sha]);
    if (!mergeBase) continue;
    const ahead = Number(
      (await gitOut(cwd, ["rev-list", "--count", `${mergeBase}..${headSha}`])) ??
        Number.POSITIVE_INFINITY,
    );
    const score = { ahead, ancestor: mergeBase === sha ? 0 : 1, index };
    if (!best || compareScore(score, best.score) < 0)
      best = { ref, mergeBase, ahead, ancestor: score.ancestor === 0, score };
  }
  return best;
}
