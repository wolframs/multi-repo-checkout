import * as vscode from "vscode";

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