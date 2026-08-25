import * as vscode from "vscode";
import { autoPull } from "./auto-pull";
import {
    getConfigAutoPullBranchUpdates,
    getConfigAutoReloadWindow,
    getConfigRegisterChangesDelay,
} from "./config";
import { ApiRepository } from "./types";

export async function finishSuccessfulSwitch(repos: ApiRepository[]): Promise<void> {
    if (await triggerAutoPull(repos)) {
        await new Promise((resolve) =>
            setTimeout(resolve, getConfigRegisterChangesDelay())
        );
    }

    const reloadSetting = getConfigAutoReloadWindow();
    if (reloadSetting === "Always") {
        await vscode.commands.executeCommand("workbench.action.reloadWindow");
        return;
    }
    if (reloadSetting === "Ask") {
        const reload = await vscode.window.showInformationMessage(
            "Do you want to reload the window?",
            { modal: false },
            { title: "Yes" },
            { title: "No" }
        );
        if (reload?.title === "Yes") {
            await vscode.commands.executeCommand("workbench.action.reloadWindow");
        }
    }
}

async function triggerAutoPull(repos: ApiRepository[]): Promise<boolean> {
    const setting = getConfigAutoPullBranchUpdates();
    if (setting === "Always") {
        await autoPull(repos);
        return true;
    }
    if (setting === "Ask") {
        const pull = await vscode.window.showInformationMessage(
            "Do you want to pull updates from each remote branch?",
            { modal: false },
            { title: "Yes" },
            { title: "No" }
        );
        if (pull?.title === "Yes") {
            await autoPull(repos);
            return true;
        }
    }
    return false;
}
