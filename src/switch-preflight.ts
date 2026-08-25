import * as vscode from "vscode";
import { RepositorySwitchPlan } from "./switch-plan";

export interface PreflightSummary {
    ready: number;
    fallback: number;
    blocked: number;
    detail: string;
}

export function createPreflightSummary(
    plans: RepositorySwitchPlan[]
): PreflightSummary {
    const ready = plans.filter((plan) => !plan.blocked).length;
    const fallback = plans.filter((plan) => plan.reason === "fallback").length;
    const blocked = plans.length - ready;
    const visiblePlans = plans.slice(0, 30);
    const lines = visiblePlans.map(formatPlan);
    if (plans.length > visiblePlans.length) {
        lines.push(`…and ${plans.length - visiblePlans.length} more repositories`);
    }
    return { ready, fallback, blocked, detail: lines.join("\n") };
}

export async function confirmSwitchPreflight(
    plans: RepositorySwitchPlan[],
    branchName: string
): Promise<boolean> {
    const summary = createPreflightSummary(plans);
    if (summary.ready === 0) {
        const close: vscode.MessageItem = {
            title: "Close",
            isCloseAffordance: true,
        };
        await vscode.window.showWarningMessage(
            `No repositories can switch to ${branchName}.`,
            { modal: true, detail: summary.detail },
            close
        );
        return false;
    }

    const message = summary.blocked > 0 || summary.fallback > 0
        ? `${summary.ready} of ${plans.length} repositories are ready to switch.`
        : `Switch ${branchName} across ${summary.ready} repositories?`;
    const action: vscode.MessageItem = {
        title: `Switch ${summary.ready} Repositories`,
    };
    const cancel: vscode.MessageItem = {
        title: "Cancel",
        isCloseAffordance: true,
    };
    const choice = summary.blocked > 0 || summary.fallback > 0
        ? await vscode.window.showWarningMessage(
            message,
            { modal: true, detail: summary.detail },
            action,
            cancel
        )
        : await vscode.window.showInformationMessage(
            message,
            { modal: true, detail: summary.detail },
            action,
            cancel
        );
    return choice?.title === action.title;
}

function formatPlan(plan: RepositorySwitchPlan): string {
    if (plan.blocked) {
        return `Blocked  ${plan.repositoryName}: ${plan.blockedMessage}`;
    }
    if (plan.reason === "fallback") {
        return `Fallback ${plan.repositoryName}: ${plan.targetBranch}`;
    }
    if (plan.source === "remote") {
        return `Ready    ${plan.repositoryName}: track origin/${plan.targetBranch}`;
    }
    if (plan.source === "new") {
        return `Ready    ${plan.repositoryName}: create ${plan.targetBranch}`;
    }
    return `Ready    ${plan.repositoryName}: ${plan.targetBranch}`;
}
