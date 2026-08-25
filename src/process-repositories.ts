import * as vscode from "vscode";
import {
    getConfigAutoReloadWindow,
    getConfigRegisterChangesDelay,
} from "./config";
import {
    createRepositorySwitchPlans,
    executeRepositorySwitchPlans,
    RepositorySwitchPlan,
} from "./switch-plan";
import { ApiRepository, BranchCatalog } from "./types";

export async function processRepositories(
    repos: ApiRepository[],
    branchName: string,
    doCreateNewBranch: boolean,
    progress?: vscode.Progress<{ message?: string; increment?: number }>,
    catalog?: BranchCatalog,
    preflightPlans?: RepositorySwitchPlan[]
): Promise<string[]> {
    const planningShare = preflightPlans ? 0 : 45;
    const executionShare = preflightPlans ? 90 : 45;
    const plans = preflightPlans ?? await createRepositorySwitchPlans(
        repos,
        branchName,
        doCreateNewBranch,
        catalog,
        (completed, total) => progress?.report({
            message: `Checking ${completed}/${total} repositories`,
            increment: total === 0 ? planningShare : planningShare / total,
        })
    );
    const results = await executeRepositorySwitchPlans(
        plans,
        catalog,
        preflightPlans !== undefined,
        (completed, total) => progress?.report({
            message: `Switching ${completed}/${total} repositories`,
            increment: total === 0 ? executionShare : executionShare / total,
        })
    );

    if (progress && getConfigAutoReloadWindow() !== "Never") {
        progress.report({ message: "Registering changes...", increment: 10 });
        await new Promise((resolve) =>
            setTimeout(resolve, getConfigRegisterChangesDelay())
        );
    }

    return sortResultsByStatus(results);
}

function sortResultsByStatus(results: string[]): string[] {
    const order: Record<string, number> = { "❌": 0, "⚠": 1, "✅": 2 };
    return results.sort((a, b) =>
        (order[a.charAt(0)] ?? 3) - (order[b.charAt(0)] ?? 3)
    );
}
