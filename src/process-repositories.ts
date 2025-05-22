import * as vscode from "vscode";
import { exec } from "child_process";
import { isRepoClean } from "./is-repo-clean";
import { ApiRepository } from "./types";
import {
    getConfigAutoReloadWindow,
    getConfigDefaultBranch,
    getConfigRegisterChangesDelay,
} from "./config";

export async function processRepositories(
    repos: ApiRepository[],
    branchName: string,
    doCreateNewBranch: boolean,
    progress?: vscode.Progress<{ message?: string; increment?: number }>
): Promise<string[]> {
    const results: string[] = [];
    const total = repos.length;
    let completed = 1;

    for (const repo of repos) {
        const repoPath = repo.root;
        const repoName = repoPath.split("\\").pop();

        progress?.report({
            message: `${repoName}`,
            increment: (1 / total) * 90,
        });

        try {
            const clean = await isRepoClean(repoPath);
            if (!clean) {
                results.push(
                    `⚠️ ${repoName}: Uncommitted changes or commits not pushed – skipped`
                );
                continue;
            }

            const [localExists, remoteExists] = await Promise.all([
                checkBranchExists(repoPath, branchName, "local"),
                checkBranchExists(repoPath, branchName, "remote"),
            ]);

            if (localExists) {
                await checkoutBranch(repoPath, branchName);
                results.push(
                    `✅ ${repoName}: Switched to existing local branch`
                );
            } else if (remoteExists) {
                await checkoutRemoteBranch(repoPath, branchName);
                results.push(
                    `✅ ${repoName}: Created local tracking branch from origin`
                );
            } else {
                if (doCreateNewBranch) {
                    await createBranch(repoPath, branchName);
                    results.push(`✅ ${repoName}: Created new local branch`);
                } else {
                    // Switch to default branch
                    await processRepositories(
                        [repo],
                        getConfigDefaultBranch(),
                        false, // not creating new branch
                        undefined // no progress report for this sub-process
                    );
                    results.push(
                        `✅ ${repoName}: Switched to ${getConfigDefaultBranch()} branch`
                    );
                }
            }
        } catch (error: any) {
            results.push(`❌ ${repoName}: ${error.message}`);
        }

        completed++;
    }

    progress?.report({
        message: "Registering changes...",
        increment: 5,
    });
    if (progress) {
        if (getConfigAutoReloadWindow() !== "Never") {
            await new Promise((resolve) =>
                setTimeout(resolve, getConfigRegisterChangesDelay())
            ); // Wait for VSCode's source control management to register the changes
        }
    }

    await sortResultsByStatus(results);
    return results;
}

async function sortResultsByStatus(results: string[]) {
    results.sort((a, b) => {
        const statusA = a.charAt(0);
        const statusB = b.charAt(0);

        if (statusA === "✅" && statusB !== "✅") {
            return 1;
        } else if (statusA !== "✅" && statusB === "✅") {
            return -1;
        } else if (statusA === "⚠️" && statusB !== "⚠️") {
            return 1;
        } else if (statusA !== "⚠️" && statusB === "⚠️") {
            return -1;
        } else if (statusA === "❌" && statusB !== "❌") {
            return 1;
        } else if (statusA !== "❌" && statusB === "❌") {
            return -1;
        }
        return 0;
    });
}

async function checkBranchExists(
    repoPath: string,
    branch: string,
    type: "local" | "remote"
): Promise<boolean> {
    const command =
        type === "local"
            ? `git show-ref --verify refs/heads/${branch}`
            : `git ls-remote --exit-code --heads origin ${branch}`;

    return new Promise((resolve, reject) => {
        exec(command, { cwd: repoPath }, (error, stdout) => {
            if (error) {
                if (
                    error.code === 1 ||
                    error.code === 2 ||
                    error.code === 128
                ) {
                    resolve(false);
                } else {
                    reject(new Error(`Check failed: ${error.message}`));
                }
            } else {
                resolve(true);
            }
        });
    });
}

async function checkoutRemoteBranch(
    repoPath: string,
    branch: string
): Promise<void> {
    return executeCommand(
        repoPath,
        `git checkout --track origin/${branch}`,
        "Checkout remote failed"
    );
}

async function checkoutBranch(repoPath: string, branch: string): Promise<void> {
    return executeCommand(
        repoPath,
        `git checkout ${branch}`,
        "Checkout failed"
    );
}

async function createBranch(repoPath: string, branch: string): Promise<void> {
    return executeCommand(
        repoPath,
        `git checkout -b ${branch}`,
        "Create branch failed"
    );
}

async function executeCommand(
    repoPath: string,
    command: string,
    errorPrefix: string
): Promise<void> {
    return new Promise((resolve, reject) => {
        exec(command, { cwd: repoPath }, (error, stdout, stderr) => {
            if (error) {
                reject(new Error(`${errorPrefix}: ${stderr || error.message}`));
            } else {
                resolve();
            }
        });
    });
}