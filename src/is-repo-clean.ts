import { runGit } from "./git-commands";

/**
 * Returns true if there are
 *   – no modified / staged / untracked files
 *   – no commits ahead of the upstream tracking branch
 */
export async function isRepoClean(repoPath: string): Promise<boolean> {
    const status = await runGit(repoPath, ["status", "--porcelain=v1"]);
    if (status.length > 0) {
        return false;
    }

    try {
        const counts = await runGit(repoPath, [
            "rev-list",
            "--left-right",
            "--count",
            "@{u}...HEAD",
        ]);
        const [, aheadText] = counts.split(/\s+/);
        return (Number.parseInt(aheadText, 10) || 0) === 0;
    } catch {
        return false;
    }
}
