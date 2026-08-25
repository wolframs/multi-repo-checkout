import * as vscode from "vscode";
import { BranchCache } from "./branch-cache";
import { collectAllBranches } from "./collect-all-branches";
import {
    getConfigCacheEnabled,
    getConfigCacheTtlSeconds,
    getConfigMaxConcurrentRepositories,
    getConfigPreflightEnabled,
    getConfigRemoteRefreshPolicy,
} from "./config";
import { assertValidBranchName } from "./git-commands";
import { getGitRepositories } from "./git-api";
import { processRepositories } from "./process-repositories";
import { finishSuccessfulSwitch } from "./post-switch";
import { createRemoteRefresher } from "./remote-refresh";
import { showBranchQuickPick } from "./show-branch-quick-pick";
import { confirmSwitchPreflight } from "./switch-preflight";
import {
    createRepositorySwitchPlans,
    RepositorySwitchPlan,
} from "./switch-plan";
import {
    ResultOutput,
    showSwitchResultNotification,
} from "./switch-result-report";
import { ApiRepository, BranchCatalog, RemoteRefreshPolicy } from "./types";

export async function switchBranches(
    cache: BranchCache,
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

    const remoteRefreshPolicy = getConfigRemoteRefreshPolicy();
    let forceRefresh = remoteRefreshPolicy === "Always";
    let catalog: BranchCatalog;
    let selection;

    while (true) {
        try {
            catalog = await collectWithProgress(
                repos,
                cache,
                forceRefresh,
                remoteRefreshPolicy
            );
        } catch (error) {
            if (error instanceof vscode.CancellationError) {
                return;
            }
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Unable to load branch refs: ${message}`);
            return;
        }
        if (catalog.staleRepositories.length > 0) {
            vscode.window.showWarningMessage(
                `Using older cached refs for: ${catalog.staleRepositories.join(", ")}`
            );
        }
        if (catalog.remoteRefreshFailures.length > 0) {
            vscode.window.showWarningMessage(
                `Could not fetch origin for: ${catalog.remoteRefreshFailures
                    .map((failure) => failure.repository)
                    .join(", ")}. Using locally available refs.`
            );
        }

        selection = await showBranchQuickPick(catalog);
        if (!selection || !selection.refresh) {
            break;
        }
        forceRefresh = true;
    }

    if (!selection?.branchName) {
        return;
    }
    if (selection.createNew) {
        try {
            await assertValidBranchName(selection.branchName);
        } catch (error) {
            vscode.window.showErrorMessage((error as Error).message);
            return;
        }
    }

    let preflightPlans: RepositorySwitchPlan[] | undefined;
    if (getConfigPreflightEnabled()) {
        preflightPlans = await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Window,
                title: "$(checklist) Checking repository switch plan",
                cancellable: false,
            },
            (progress) => createRepositorySwitchPlans(
                repos,
                selection.branchName!,
                selection.createNew === true,
                catalog,
                (completed, total) => progress.report({
                    message: `${completed}/${total} repositories`,
                    increment: total === 0 ? 100 : 100 / total,
                })
            )
        );
        if (!(await confirmSwitchPreflight(preflightPlans, selection.branchName))) {
            return;
        }
    }

    let finalResults: string[] = [];
    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: "Switching branches",
            cancellable: false,
        },
        async (progress) => {
            finalResults = await processRepositories(
                repos,
                selection.branchName!,
                selection.createNew === true,
                progress,
                catalog,
                preflightPlans
            );
        }
    );
    if (getConfigCacheEnabled()) {
        await cache.persistLocalChanges(catalog);
    }

    void showSwitchResultNotification(
        "Checkouts complete",
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

export async function refreshBranchCache(cache: BranchCache): Promise<void> {
    const repos = await getGitRepositories();
    if (!repos) {
        return;
    }
    if (!repos.length) {
        vscode.window.showInformationMessage("No repositories found");
        return;
    }

    let catalog: BranchCatalog;
    const remoteRefreshPolicy = getConfigRemoteRefreshPolicy();
    try {
        catalog = await collectWithProgress(
            repos,
            cache,
            true,
            remoteRefreshPolicy
        );
    } catch (error) {
        if (error instanceof vscode.CancellationError) {
            return;
        }
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Unable to refresh branch refs: ${message}`);
        return;
    }
    if (catalog.staleRepositories.length > 0) {
        vscode.window.showWarningMessage(
            `Could not refresh refs for: ${catalog.staleRepositories.join(", ")}`
        );
        return;
    }
    if (catalog.remoteRefreshFailures.length > 0) {
        vscode.window.showWarningMessage(
            `Branch refs refreshed locally, but origin could not be fetched for: ${catalog.remoteRefreshFailures
                .map((failure) => failure.repository)
                .join(", ")}.`
        );
        return;
    }
    vscode.window.showInformationMessage(`Branch refs refreshed from ${repos.length} repositories.`);
}

async function collectWithProgress(
    repos: ApiRepository[],
    cache: BranchCache,
    forceRefresh: boolean,
    remoteRefreshPolicy: RemoteRefreshPolicy
): Promise<BranchCatalog> {
    return vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Window,
            title: forceRefresh ? "$(refresh) Refreshing repository refs" : "$(git-branch) Loading repository refs",
            cancellable: true,
        },
        (progress, cancellationToken) => collectAllBranches(repos, cache, progress, {
            enabled: getConfigCacheEnabled(),
            ttlMs: getConfigCacheTtlSeconds() * 1000,
            forceRefresh,
            maxConcurrency: getConfigMaxConcurrentRepositories(),
            cancellationToken,
            refreshRemote: createRemoteRefresher(remoteRefreshPolicy),
        })
    );
}
