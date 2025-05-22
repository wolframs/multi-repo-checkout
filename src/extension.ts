import * as vscode from "vscode";
import { switchBranches } from "./switch-branches";

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "multi-repo-branch-switcher.switchBranches",
            async () => {
                await switchBranches();
            }
        )
    );
}

export function deactivate() {}
