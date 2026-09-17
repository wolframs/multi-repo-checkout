import * as vscode from "vscode";
import { refreshBranchCache, switchBranches } from "./switch-branches";
import { deleteStaleBranches } from "./prune-stale-branches";
import { switchToDefaultBranch } from "./switch-to-default-branch";
import { BranchCache } from "./branch-cache";
import { BackgroundRefresh } from "./background-refresh";
import {
    affectsBackgroundSchedule,
    getConfigBackgroundRefreshIntervalSeconds,
    getConfigCacheOptions,
    getConfigRemoteRefreshPolicy,
} from "./config";
import { getGitRepositories } from "./git-api";
import { createRemoteRefresher } from "./remote-refresh";

export function activate(context: vscode.ExtensionContext) {
    const branchCache = new BranchCache(context.workspaceState);
    const switchResultOutput = vscode.window.createOutputChannel(
        "Multi-Repo Branch Switcher - Results"
    );
    // Switch results clear their channel on every switch, so background
    // diagnostics — which raise no notification — need one of their own.
    const backgroundOutput = vscode.window.createOutputChannel(
        "Multi-Repo Branch Switcher - Background Refresh"
    );
    const backgroundRefresh = new BackgroundRefresh(
        branchCache,
        getGitRepositories,
        () => ({
            ...getConfigCacheOptions(),
            intervalMs: getConfigBackgroundRefreshIntervalSeconds() * 1000,
            refreshRemote: createRemoteRefresher(getConfigRemoteRefreshPolicy()),
        }),
        (message) => backgroundOutput.appendLine(`[${new Date().toISOString()}] ${message}`)
    );
    context.subscriptions.push(
        switchResultOutput,
        backgroundOutput,
        backgroundRefresh,
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (affectsBackgroundSchedule(event)) {
                backgroundRefresh.configure();
            }
        }),
        vscode.commands.registerCommand(
            "multi-repo-branch-switcher.switchBranches",
            async () => {
                await switchBranches(branchCache, switchResultOutput);
            }
        ),
        vscode.commands.registerCommand(
            "multi-repo-branch-switcher.deleteStaleBranches",
            async () => {
                await deleteStaleBranches();
            }
        ),
        vscode.commands.registerCommand(
            "multi-repo-branch-switcher.switchToDefaultBranch",
            async () => {
                await switchToDefaultBranch(switchResultOutput);
            }
        ),
        vscode.commands.registerCommand(
            "multi-repo-branch-switcher.refreshBranchCache",
            async () => {
                await refreshBranchCache(branchCache);
            }
        )
    );
}

export function deactivate() {}
