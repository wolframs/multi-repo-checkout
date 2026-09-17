import { execFile } from "child_process";

export function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export function runGit(repoPath: string | undefined, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
        execFile("git", args, repoPath ? { cwd: repoPath } : {}, (error, stdout, stderr) => {
            if (error) {
                reject(new Error(stderr.trim() || error.message));
                return;
            }
            resolve(stdout.trim());
        });
    });
}

export async function branchExists(
    repoPath: string,
    branch: string,
    type: "local" | "remote"
): Promise<boolean> {
    const ref = type === "local"
        ? `refs/heads/${branch}`
        : `refs/remotes/origin/${branch}`;
    try {
        await runGit(repoPath, ["show-ref", "--quiet", "--verify", "--", ref]);
        return true;
    } catch {
        return false;
    }
}

export async function checkoutBranch(
    repoPath: string,
    branch: string,
    source: "local" | "remote" | "new"
): Promise<void> {
    const args = source === "remote"
        ? ["checkout", "--track", `origin/${branch}`]
        : source === "new"
            ? ["checkout", "-b", branch]
            : ["checkout", branch];
    try {
        await runGit(repoPath, args);
    } catch (error) {
        const prefix = source === "remote"
            ? "Checkout remote failed"
            : source === "new"
                ? "Create branch failed"
                : "Checkout failed";
        throw new Error(`${prefix}: ${(error as Error).message}`);
    }
}

export async function assertValidBranchName(branch: string): Promise<void> {
    if (!branch) {
        throw new Error("Branch name cannot be empty");
    }
    try {
        await runGit(undefined, ["check-ref-format", "--branch", branch]);
    } catch {
        throw new Error(`Invalid branch name: ${branch}`);
    }
}
