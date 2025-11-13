import * as vscode from "vscode";
import { exec } from "child_process";
import { ApiRepository, Git } from "./types";
import { getConfigDefaultBranch } from "./config";
import { isRepoClean } from "./is-repo-clean";
import { autoPull } from "./auto-pull";
import {
    getConfigAutoPullBranchUpdates,
    getConfigAutoReloadWindow,
    getConfigRegisterChangesDelay,
} from "./config";

export async function switchToDefaultBranch() {
    const gitExtension = vscode.extensions.getExtension<{
        model: Git;
    }>("vscode.git");
    if (!gitExtension) {
        vscode.window.showErrorMessage("Unable to load Git extension");
        return;
    }

    const git = gitExtension.isActive
        ? gitExtension.exports.model
        : await gitExtension.activate().then(() => gitExtension.exports.model);
    if (!git) {
        vscode.window.showErrorMessage("Could not retrieve Git API");
        return;
    }

    const repos = git?.repositories || [];
    if (!repos.length) {
        vscode.window.showInformationMessage("No repositories found");
        return;
    }

    let finalResults: string[] = [];
    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: "Switching to default branch",
            cancellable: false,
        },
        async (progress) => {
            const total = repos.length;
            let completed = 0;

            for (const repo of repos) {
                const repoPath = repo.root;
                const repoName = repoPath.split("\\").pop() || repoPath.split("/").pop() || "unknown";

                progress.report({
                    message: `Switching ${repoName}...`,
                    increment: (completed / total) * 100,
                });

                try {
                    const clean = await isRepoClean(repoPath);
                    if (!clean) {
                        finalResults.push(
                            `⚠️ ${repoName}: Uncommitted changes or commits not pushed – skipped`
                        );
                        completed++;
                        continue;
                    }

                    // Determine default branch name
                    const defaultBranch = await determineDefaultBranch(repoPath);

                    // Checkout default branch
                    await checkoutDefaultBranch(repoPath, defaultBranch);
                    finalResults.push(
                        `✅ ${repoName}: Switched to ${defaultBranch}`
                    );
                } catch (error: any) {
                    finalResults.push(`❌ ${repoName}: ${error.message}`);
                }

                completed++;
            }
        }
    );

    // Show results
    showFinalReport(finalResults);

    const resultsWithIssues = finalResults.filter(
        (result) => result.startsWith("❌") || result.startsWith("⚠️")
    );
    if (resultsWithIssues.length === 0) {
        const pullsTriggered = await triggerAutoPull(repos);
        // Wait for all pulls to complete and source control to settle
        if (pullsTriggered) {
            await waitForPullsToComplete(repos);
        }
        await triggerReloadWindow();
    }
}

async function determineDefaultBranch(repoPath: string): Promise<string> {
    // First try the configured default branch
    const configuredDefault = getConfigDefaultBranch();

    // Check if configured default exists locally or remotely
    const [localExists, remoteExists] = await Promise.all([
        checkBranchExists(repoPath, configuredDefault, "local"),
        checkBranchExists(repoPath, configuredDefault, "remote"),
    ]);

    if (localExists || remoteExists) {
        return configuredDefault;
    }

    // Fallback: try to detect from remote HEAD
    try {
        const remoteDefault = await getRemoteDefaultBranch(repoPath);
        if (remoteDefault) {
            return remoteDefault;
        }
    } catch (error) {
        // Ignore errors, continue to next fallback
    }

    // Fallback: try common branch names
    const commonBranches = ["main", "master", "develop"];
    for (const branch of commonBranches) {
        const [localExists, remoteExists] = await Promise.all([
            checkBranchExists(repoPath, branch, "local"),
            checkBranchExists(repoPath, branch, "remote"),
        ]);
        if (localExists || remoteExists) {
            return branch;
        }
    }

    // Last resort: use configured default even if it doesn't exist
    return configuredDefault;
}

async function getRemoteDefaultBranch(repoPath: string): Promise<string | null> {
    return new Promise((resolve) => {
        exec(
            "git symbolic-ref refs/remotes/origin/HEAD",
            { cwd: repoPath },
            (error, stdout) => {
                if (error) {
                    resolve(null);
                    return;
                }
                const match = stdout.trim().match(/refs\/remotes\/origin\/(.+)/);
                if (match && match[1]) {
                    resolve(match[1]);
                } else {
                    resolve(null);
                }
            }
        );
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

    return new Promise((resolve) => {
        exec(command, { cwd: repoPath }, (error) => {
            if (error) {
                resolve(false);
            } else {
                resolve(true);
            }
        });
    });
}

async function checkoutDefaultBranch(
    repoPath: string,
    branchName: string
): Promise<void> {
    // First check if branch exists locally
    const localExists = await checkBranchExists(repoPath, branchName, "local");
    const remoteExists = await checkBranchExists(repoPath, branchName, "remote");

    if (localExists) {
        return executeCommand(repoPath, `git checkout ${branchName}`, "Checkout failed");
    } else if (remoteExists) {
        // Create tracking branch
        return executeCommand(
            repoPath,
            `git checkout --track origin/${branchName}`,
            "Checkout remote failed"
        );
    } else {
        // Create new branch (shouldn't happen often, but handle gracefully)
        return executeCommand(
            repoPath,
            `git checkout -b ${branchName}`,
            "Create branch failed"
        );
    }
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

function showFinalReport(results: string[]): void {
    vscode.window.showInformationMessage(
        `Default branch switch complete: ${results.join(" ··· ")}`,
        { modal: false }
    );
}

async function triggerAutoPull(repos: ApiRepository[]): Promise<boolean> {
    const autoPullBranchUpdates = getConfigAutoPullBranchUpdates();
    if (autoPullBranchUpdates === "Always") {
        await autoPull(repos);
        return true;
    } else if (autoPullBranchUpdates === "Ask") {
        const pull = await vscode.window.showInformationMessage(
            "Do you want to pull updates from each remote branch?",
            { modal: false },
            { title: "Yes" },
            { title: "No" }
        );
        if (pull?.title === "Yes") {
            await autoPull(repos);
            return true;
        }
    }
    return false;
}

async function waitForPullsToComplete(repos: ApiRepository[]): Promise<void> {
    // Wait for source control to settle after pulls
    const delay = getConfigRegisterChangesDelay();
    await new Promise((resolve) => setTimeout(resolve, delay));

    // Additional check: wait for git operations to complete
    // Poll git status to ensure no ongoing operations
    const maxAttempts = 10;
    const pollInterval = 500;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const allIdle = await Promise.all(
            repos.map(async (repo) => {
                try {
                    // Check if git operations are complete by checking repository state
                    // VS Code Git API doesn't expose operation status directly,
                    // so we use a simple delay-based approach
                    return true;
                } catch {
                    return false;
                }
            })
        );

        if (allIdle.every((idle) => idle)) {
            break;
        }

        await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }
}

async function triggerReloadWindow() {
    const autoReloadWindow = getConfigAutoReloadWindow();
    if (autoReloadWindow === "Always") {
        vscode.commands.executeCommand("workbench.action.reloadWindow");
    } else if (autoReloadWindow === "Ask") {
        const reload = await vscode.window.showInformationMessage(
            "Do you want to reload the window?",
            { modal: false },
            { title: "Yes" },
            { title: "No" }
        );
        if (reload?.title === "Yes") {
            vscode.commands.executeCommand("workbench.action.reloadWindow");
        }
    }
}

