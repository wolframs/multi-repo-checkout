import * as vscode from "vscode";

const SHOW_DETAILS_TITLE = "Show Details";

export interface SwitchResultCounts {
    succeeded: number;
    skipped: number;
    failed: number;
}

export interface ResultOutput {
    clear(): void;
    appendLine(value: string): void;
    show(preserveFocus?: boolean): void;
}

export type InformationMessagePresenter = (
    message: string,
    options: vscode.MessageOptions,
    item: vscode.MessageItem
) => Thenable<vscode.MessageItem | undefined>;

export function countSwitchResults(results: string[]): SwitchResultCounts {
    return results.reduce<SwitchResultCounts>(
        (counts, result) => {
            if (result.startsWith("✅")) {
                counts.succeeded++;
            } else if (result.startsWith("⚠️")) {
                counts.skipped++;
            } else {
                counts.failed++;
            }
            return counts;
        },
        { succeeded: 0, skipped: 0, failed: 0 }
    );
}

export function formatSwitchResultSummary(results: string[]): string {
    const counts = countSwitchResults(results);
    const parts = [
        counts.succeeded > 0 ? `${counts.succeeded} succeeded` : undefined,
        counts.skipped > 0 ? `${counts.skipped} skipped` : undefined,
        counts.failed > 0 ? `${counts.failed} failed` : undefined,
    ].filter((part): part is string => part !== undefined);
    return parts.join(" · ") || "No repositories processed";
}

export async function showSwitchResultNotification(
    title: string,
    results: string[],
    output: ResultOutput,
    present: InformationMessagePresenter = (
        message,
        options,
        item
    ) => vscode.window.showInformationMessage(message, options, item)
): Promise<void> {
    const summary = formatSwitchResultSummary(results);
    output.clear();
    output.appendLine(title);
    output.appendLine(summary);
    output.appendLine("");
    for (const result of results) {
        output.appendLine(result);
    }

    const choice = await present(
        `${title}: ${summary}`,
        { modal: false },
        { title: SHOW_DETAILS_TITLE }
    );
    if (choice?.title === SHOW_DETAILS_TITLE) {
        output.show();
    }
}
