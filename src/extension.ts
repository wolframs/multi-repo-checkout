import * as vscode from "vscode";
import { switchBranches } from "./switch-branches";
import { deleteStaleBranches } from "./prune-stale-branches";
import { switchToDefaultBranch } from "./switch-to-default-branch";

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "multi-repo-branch-switcher.switchBranches",
            async () => {
                await switchBranches();
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
                await switchToDefaultBranch();
            }
        )
    );
}

export function deactivate() {}
