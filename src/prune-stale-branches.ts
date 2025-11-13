import * as vscode from "vscode";
import { exec, execFile } from "child_process";
import { ApiRepository, Git } from "./types";
import {
    getConfigPruneCutoffDays,
    getConfigPruneProtected,
    getConfigPruneDryRun,
} from "./config";
import { isRepoClean } from "./is-repo-clean";

interface BranchInfo {
    name: string;
    lastCommitDate: Date;
}

interface PruneResult {
    repoName: string;
    deletedBranches: string[];
    skippedBranches: string[];
    errors: string[];
}

export async function deleteStaleBranches() {
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

    const cutoffDays = getConfigPruneCutoffDays();
    const protectedPatterns = getConfigPruneProtected();
    const dryRun = getConfigPruneDryRun();

    // Compile protected regex patterns
    const protectedRegexes = protectedPatterns.map((pattern) => new RegExp(pattern));

    // If not dry-run, show confirmation
    if (!dryRun) {
        const confirmed = await vscode.window.showWarningMessage(
            `This will delete stale local branches older than ${cutoffDays} days across all repositories. Protected branches will be skipped. Continue?`,
            { modal: true },
            { title: "Yes" },
            { title: "No" }
        );
        if (confirmed?.title !== "Yes") {
            return;
        }
    }

    let results: PruneResult[] = [];
    const outputChannel = vscode.window.createOutputChannel(
        "Multi-Repo Branch Switcher"
    );

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: dryRun
                ? "Previewing stale branches..."
                : "Deleting stale branches...",
            cancellable: false,
        },
        async (progress) => {
            const total = repos.length;
            let completed = 0;

            for (const repo of repos) {
                const repoPath = repo.root;
                const repoName = repoPath.split("\\").pop() || repoPath.split("/").pop() || "unknown";

                progress.report({
                    message: `Processing ${repoName}...`,
                    increment: (completed / total) * 100,
                });

                const result = await processRepoForStaleBranches(
                    repoPath,
                    repoName,
                    cutoffDays,
                    protectedRegexes,
                    dryRun,
                    outputChannel
                );
                results.push(result);
                completed++;
            }
        }
    );

    // Show summary
    showPruneSummary(results, dryRun, outputChannel);
}

async function processRepoForStaleBranches(
    repoPath: string,
    repoName: string,
    cutoffDays: number,
    protectedRegexes: RegExp[],
    dryRun: boolean,
    outputChannel: vscode.OutputChannel
): Promise<PruneResult> {
    const result: PruneResult = {
        repoName,
        deletedBranches: [],
        skippedBranches: [],
        errors: [],
    };

    try {
        // Check if repo is clean (skip dirty repos)
        const clean = await isRepoClean(repoPath);
        if (!clean) {
            result.errors.push("Repository has uncommitted changes - skipped");
            outputChannel.appendLine(
                `⚠️ ${repoName}: Repository has uncommitted changes - skipped`
            );
            return result;
        }

        // Get all local branches with their last commit dates
        const branches = await getLocalBranchesWithDates(repoPath);
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - cutoffDays);

        // Get current branch name
        const currentBranch = await getCurrentBranch(repoPath);

        for (const branch of branches) {
            // Skip current branch
            if (branch.name === currentBranch) {
                result.skippedBranches.push(branch.name);
                continue;
            }

            // Check if branch is protected
            const isProtected = protectedRegexes.some((regex) =>
                regex.test(branch.name)
            );
            if (isProtected) {
                result.skippedBranches.push(branch.name);
                continue;
            }

            // Check if branch is stale
            if (branch.lastCommitDate < cutoffDate) {
                if (dryRun) {
                    result.deletedBranches.push(branch.name);
                    outputChannel.appendLine(
                        `[DRY RUN] Would delete: ${repoName}/${branch.name} (last commit: ${branch.lastCommitDate.toLocaleDateString()})`
                    );
                } else {
                    try {
                        await deleteBranch(repoPath, branch.name);
                        result.deletedBranches.push(branch.name);
                        outputChannel.appendLine(
                            `✅ Deleted: ${repoName}/${branch.name} (last commit: ${branch.lastCommitDate.toLocaleDateString()})`
                        );
                    } catch (error: any) {
                        result.errors.push(
                            `Failed to delete ${branch.name}: ${error.message}`
                        );
                        outputChannel.appendLine(
                            `❌ Failed to delete ${repoName}/${branch.name}: ${error.message}`
                        );
                    }
                }
            }
        }
    } catch (error: any) {
        result.errors.push(`Error processing repository: ${error.message}`);
        outputChannel.appendLine(
            `❌ Error processing ${repoName}: ${error.message}`
        );
    }

    return result;
}

async function getLocalBranchesWithDates(
    repoPath: string
): Promise<BranchInfo[]> {
    return new Promise((resolve, reject) => {
        execFile(
            "git",
            [
                "for-each-ref",
                "--format=%(refname:short)|%(committerdate:iso)",
                "refs/heads/",
            ],
            { cwd: repoPath },
            (error, stdout) => {
                if (error) {
                    reject(new Error(`Failed to list branches: ${error.message}`));
                    return;
                }

                const branches: BranchInfo[] = [];
                const lines = stdout.trim().split("\n").filter((line) => line.length > 0);

                for (const line of lines) {
                    const [name, dateStr] = line.split("|");
                    if (name && dateStr) {
                        const date = new Date(dateStr.trim());
                        if (!isNaN(date.getTime())) {
                            branches.push({ name: name.trim(), lastCommitDate: date });
                        }
                    }
                }

                resolve(branches);
            }
        );
    });
}

async function getCurrentBranch(repoPath: string): Promise<string> {
    return new Promise((resolve, reject) => {
        exec(
            "git rev-parse --abbrev-ref HEAD",
            { cwd: repoPath },
            (error, stdout) => {
                if (error) {
                    reject(new Error(`Failed to get current branch: ${error.message}`));
                    return;
                }
                resolve(stdout.trim());
            }
        );
    });
}

async function deleteBranch(repoPath: string, branchName: string): Promise<void> {
    return new Promise((resolve, reject) => {
        exec(
            `git branch -D ${branchName}`,
            { cwd: repoPath },
            (error, stdout, stderr) => {
                if (error) {
                    reject(new Error(stderr || error.message));
                    return;
                }
                resolve();
            }
        );
    });
}

function showPruneSummary(
    results: PruneResult[],
    dryRun: boolean,
    outputChannel: vscode.OutputChannel
): void {
    const totalDeleted = results.reduce(
        (sum, r) => sum + r.deletedBranches.length,
        0
    );
    const totalSkipped = results.reduce(
        (sum, r) => sum + r.skippedBranches.length,
        0
    );
    const totalErrors = results.reduce((sum, r) => sum + r.errors.length, 0);

    outputChannel.appendLine("\n=== Prune Summary ===");
    outputChannel.appendLine(
        `${dryRun ? "Would delete" : "Deleted"}: ${totalDeleted} branch(es)`
    );
    outputChannel.appendLine(`Skipped: ${totalSkipped} branch(es)`);
    if (totalErrors > 0) {
        outputChannel.appendLine(`Errors: ${totalErrors}`);
    }
    outputChannel.appendLine("");

    // Show detailed results per repo
    for (const result of results) {
        if (
            result.deletedBranches.length > 0 ||
            result.errors.length > 0
        ) {
            outputChannel.appendLine(`\n${result.repoName}:`);
            if (result.deletedBranches.length > 0) {
                outputChannel.appendLine(
                    `  ${dryRun ? "Would delete" : "Deleted"}: ${result.deletedBranches.join(", ")}`
                );
            }
            if (result.errors.length > 0) {
                outputChannel.appendLine(`  Errors: ${result.errors.join("; ")}`);
            }
        }
    }

    outputChannel.show();

    // Show notification
    if (dryRun) {
        vscode.window.showInformationMessage(
            `Preview complete: ${totalDeleted} branch(es) would be deleted. Check output channel for details.`
        );
    } else {
        if (totalDeleted > 0) {
            vscode.window.showInformationMessage(
                `Deleted ${totalDeleted} stale branch(es) across ${results.length} repository(ies). Check output channel for details.`
            );
        } else {
            vscode.window.showInformationMessage(
                "No stale branches found to delete."
            );
        }
    }
}

