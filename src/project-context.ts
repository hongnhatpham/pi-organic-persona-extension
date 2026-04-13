import { createHash } from "node:crypto";
import path from "node:path";
import { execFileSync } from "node:child_process";

export interface ProjectContext {
  cwd: string;
  repoRoot?: string;
  projectName?: string;
  projectId?: string;
  relativeCwd?: string;
}

function stableId(value: string): string {
  return createHash("sha1").update(value).digest("hex").slice(0, 12);
}

export function detectProjectContext(cwd: string): ProjectContext {
  const context: ProjectContext = { cwd };

  try {
    const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (!repoRoot) return context;

    context.repoRoot = repoRoot;
    context.projectName = path.basename(repoRoot);
    context.projectId = stableId(repoRoot);
    const relativeCwd = path.relative(repoRoot, cwd);
    context.relativeCwd = relativeCwd && relativeCwd !== "" ? relativeCwd : ".";
  } catch {
    // no repo root available
  }

  return context;
}
