import * as path from "path";
import * as vscode from "vscode";
import { mapWithConcurrency } from "./concurrency";
import {
    getConfigDefaultBranch,
    getConfigMaxConcurrentRepositories,
} from "./config";
import { branchExists, checkoutBranch, runGit } from "./git-commands";
import { getGitRepositories, repositoryPath } from "./git-api";
import { isRepoClean } from "./is-repo-clean";
import { finishSuccessfulSwitch } from "./post-switch";
import {
    ResultOutput,
    showSwitchResultNotification,
} from "./switch-result-report";
import { ApiRepository } from "./types";

interface ResolvedBranch {
    name: string;
    source: "local" | "remote" | "new";
}

export async function switchToDefaultBranch(
    resultOutput: ResultOutput
): Promise<void> {
    const repos = await getGitRepositories();
    if (!repos) {
        return;
    }
    if (!repos.length) {
        vscode.window.showInformationMessage("No repositories found");
        return;
    }

    let completed = 0;
    const finalResults = await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: "Switching to default branch",
            cancellable: false,
        },
        (progress) => mapWithConcurrency(
            repos,
            getConfigMaxConcurrentRepositories(),
            async (repo) => {
                const result = await switchRepositoryToDefault(repo);
                completed++;
                progress.report({
                    message: `${completed}/${repos.length} repositories`,
                    increment: 100 / repos.length,
                });
                return result;
            }
        )
    );

    void showSwitchResultNotification(
        "Default branch switch complete",
        finalResults,
        resultOutput
    );

    const hasIssues = finalResults.some(
        (result) => result.startsWith("❌") || result.startsWith("⚠️")
    );
    if (!hasIssues) {
        await finishSuccessfulSwitch(repos);
    }
}

async function switchRepositoryToDefault(repo: ApiRepository): Promise<string> {
    const repoPath = repositoryPath(repo);
    const repoName = path.basename(repoPath);
    try {
        if (!(await isRepoClean(repoPath))) {
            return `⚠️ ${repoName}: Uncommitted changes or commits not pushed – skipped`;
        }
        const branch = await determineDefaultBranch(repoPath);
        await checkoutBranch(repoPath, branch.name, branch.source);
        return `✅ ${repoName}: Switched to ${branch.name}`;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return `❌ ${repoName}: ${message}`;
    }
}

export async function determineDefaultBranch(repoPath: string): Promise<ResolvedBranch> {
    const configured = getConfigDefaultBranch();
    const configuredSource = await getBranchSource(repoPath, configured);
    if (configuredSource) {
        return { name: configured, source: configuredSource };
    }

    const remoteDefault = await getRemoteDefaultBranch(repoPath);
    if (remoteDefault) {
        const source = await getBranchSource(repoPath, remoteDefault);
        if (source) {
            return { name: remoteDefault, source };
        }
    }

    for (const name of ["main", "master", "develop"]) {
        if (name === configured || name === remoteDefault) {
            continue;
        }
        const source = await getBranchSource(repoPath, name);
        if (source) {
            return { name, source };
        }
    }

    return { name: configured, source: "new" };
}

async function getRemoteDefaultBranch(repoPath: string): Promise<string | undefined> {
    try {
        const ref = await runGit(repoPath, [
            "symbolic-ref",
            "refs/remotes/origin/HEAD",
        ]);
        return ref.match(/^refs\/remotes\/origin\/(.+)$/)?.[1];
    } catch {
        return undefined;
    }
}

async function getBranchSource(
    repoPath: string,
    branch: string
): Promise<"local" | "remote" | undefined> {
    const [local, remote] = await Promise.all([
        branchExists(repoPath, branch, "local"),
        branchExists(repoPath, branch, "remote"),
    ]);
    return local ? "local" : remote ? "remote" : undefined;
}
