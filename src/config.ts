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