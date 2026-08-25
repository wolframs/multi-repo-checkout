import * as vscode from "vscode";
import { refreshBranchCache, switchBranches } from "./switch-branches";
import { deleteStaleBranches } from "./prune-stale-branches";
import { switchToDefaultBranch } from "./switch-to-default-branch";
import { BranchCache } from "./branch-cache";

export function activate(context: vscode.ExtensionContext) {
    const branchCache = new BranchCache(context.workspaceState);
    const switchResultOutput = vscode.window.createOutputChannel(
        "Multi-Repo Branch Switcher - Results"
    );
    context.subscriptions.push(
        switchResultOutput,
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
