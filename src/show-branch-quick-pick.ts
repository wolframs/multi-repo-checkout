import * as vscode from "vscode";

export async function showBranchQuickPick(
    allBranches: Set<string>
): Promise<string | undefined> {
    const branchItems: vscode.QuickPickItem[] = Array.from(allBranches)
        .sort()
        .map((branch) => ({ label: branch }));

    const newBranchesLbl = "$(plus) Create New Branches for All Repos";

    branchItems.push({
        label: newBranchesLbl,
        description: "Create a new branch in all repositories",
    });

    const selected = await vscode.window.showQuickPick(branchItems, {
        placeHolder: 'Select branch or select "create new"',
        ignoreFocusOut: true,
    });

    if (!selected) {
        return undefined;
    }

    if (selected.label === newBranchesLbl) {
        const newBranchName = await vscode.window.showInputBox({
            prompt: "Enter new branch name",
            placeHolder: "e.g., 1052-ticket-name",
            validateInput: (input) =>
                input.includes(" ")
                    ? "Branch name cannot contain spaces"
                    : null,
        });
        return "$(plus)" + newBranchName;
    }

    return selected.label;
}