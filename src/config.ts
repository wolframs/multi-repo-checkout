import * as vscode from "vscode";
import { RemoteRefreshPolicy } from "./types";

export function getConfigDefaultBranch(): string {
    const config = vscode.workspace.getConfiguration("multiRepoBranchSwitcher");
    return config.get<string>("defaultBranchName", "master");
}

export function getConfigRegisterChangesDelay(): number {
    const config = vscode.workspace.getConfiguration("multiRepoBranchSwitcher");
    return config.get<number>("registerChangesDelay", 1500);
}

export function getConfigAutoReloadWindow(): string {
    const config = vscode.workspace.getConfiguration("multiRepoBranchSwitcher");
    return config.get<string>("autoReloadWindow", "Ask");
}

export function getConfigAutoPullBranchUpdates(): string {
    const config = vscode.workspace.getConfiguration("multiRepoBranchSwitcher");
    return config.get<string>("autoPullBranchUpdates", "Ask");
}

export function getConfigPruneCutoffDays(): number {
    const config = vscode.workspace.getConfiguration("multiRepoBranchSwitcher.prune");
    return config.get<number>("cutoffDays", 14);
}

export function getConfigPruneProtected(): string[] {
    const config = vscode.workspace.getConfiguration("multiRepoBranchSwitcher.prune");
    return config.get<string[]>("protected", ["^(main|master|develop)$"]);
}

export function getConfigPruneDryRun(): boolean {
    const config = vscode.workspace.getConfiguration("multiRepoBranchSwitcher.prune");
    return config.get<boolean>("dryRun", false);
}

export function getConfigCacheEnabled(): boolean {
    const config = vscode.workspace.getConfiguration("multiRepoBranchSwitcher.cache");
    return config.get<boolean>("enabled", true);
}

export function getConfigCacheTtlSeconds(): number {
    const config = vscode.workspace.getConfiguration("multiRepoBranchSwitcher.cache");
    return Math.max(0, config.get<number>("ttlSeconds", 300));
}

export function getConfigRemoteRefreshPolicy(): RemoteRefreshPolicy {
    const config = vscode.workspace.getConfiguration(
        "multiRepoBranchSwitcher.remoteRefresh"
    );
    const policy = config.get<string>("policy", "When Cache Expires");
    return policy === "Never" || policy === "Always"
        ? policy
        : "When Cache Expires";
}

export function getConfigPreflightEnabled(): boolean {
    const config = vscode.workspace.getConfiguration(
        "multiRepoBranchSwitcher.preflight"
    );
    return config.get<boolean>("enabled", false);
}

export function getConfigMaxConcurrentRepositories(): number {
    const config = vscode.workspace.getConfiguration("multiRepoBranchSwitcher");
    return Math.min(
        32,
        Math.max(1, Math.floor(config.get<number>("maxConcurrentRepositories", 4)))
    );
}
