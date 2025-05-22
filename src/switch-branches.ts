import * as vscode from "vscode";
import { ApiRepository, Git } from "./types";
import { collectAllBranches } from "./collect-all-branches";
import {
    getConfigAutoPullBranchUpdates,
    getConfigAutoReloadWindow,
} from "./config";
import { autoPull } from "./auto-pull";
import { showBranchQuickPick } from "./show-branch-quick-pick";
import { processRepositories } from "./process-repositories";

export async function switchBranches() {
    const gitExtension = vscode.extensions.getExtension<{
        model: Git;
    }>("vscode.git");
    if (!gitExtension) {
        vscode.window.showErrorMessage("Unable to load Git extension");
        return;
    }

    const git = gitExtension.isActive
        ? gitExtension.exports.model
        : await gitExtension.activate().then(() => gitExtension.exports.model);
    if (!git) {
        vscode.window.showErrorMessage("Could not retrieve Git API");
        return;
    }

    const repos = git?.repositories || [];
    if (!repos.length) {
        vscode.window.showInformationMessage("No repositories found");
        return;
    }

    // Collect all unique branch names from all repositories
    let allBranches = new Set<string>();
    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Window,
            title: "$(git-fetch) Collecting repository refs",
            cancellable: false,
        },
        async (progress) => {
            allBranches = await collectAllBranches(repos, progress);
        }
    );

    // Show branch selection quick pick
    const branchName = await showBranchQuickPick(allBranches);
    if (!branchName) {
        return;
    }

    // Process all repositories
    const createNewBranch = branchName.startsWith("$(plus)");
    const branchNameWithoutPlus = createNewBranch
        ? branchName.substring("$(plus)".length)
        : branchName;

    let finalResults: string[] = [];
    await vscode.window.withProgress(
        { location: vscode.ProgressLocation.SourceControl },
        async () => {
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: `Switching branches`,
                    cancellable: false,
                },
                async (notification_progress) => {
                    finalResults = await processRepositories(
                        repos,
                        branchNameWithoutPlus,
                        createNewBranch,
                        notification_progress
                    );
                }
            );
        }
    );

    showFinalReport(finalResults);

    const resultsWithIssues = finalResults.filter(
        (result) => result.startsWith("❌") || result.startsWith("⚠️")
    );
    if (resultsWithIssues.length === 0) {
        await triggerAutoPull(repos);
        await triggerReloadWindow();
    }
}

function showFinalReport(results: string[]): void {
    vscode.window.showInformationMessage(
        `Checkouts complete: ${results.join(" ··· ")}`,
        { modal: false }
    );
}

async function triggerReloadWindow() {
    const autoReloadWindow = getConfigAutoReloadWindow();
    if (autoReloadWindow === "Always") {
        vscode.commands.executeCommand("workbench.action.reloadWindow");
    } else if (autoReloadWindow === "Ask") {
        const reload = await vscode.window.showInformationMessage(
            "Do you want to reload the window?",
            { modal: false },
            { title: "Yes" },
            { title: "No" }
        );
        if (reload?.title === "Yes") {
            vscode.commands.executeCommand("workbench.action.reloadWindow");
        }
    }
}

async function triggerAutoPull(repos: ApiRepository[]) {
    const autoPullBranchUpdates = getConfigAutoPullBranchUpdates();
    if (autoPullBranchUpdates === "Always") {
        autoPull(repos);
    } else if (autoPullBranchUpdates === "Ask") {
        const pull = await vscode.window.showInformationMessage(
            "Do you want to pull updates from each remote branch?",
            { modal: false },
            { title: "Yes" },
            { title: "No" }
        );
        if (pull?.title === "Yes") {
            autoPull(repos);
        }
    }
}
