import * as vscode from "vscode";
import { BranchCatalog } from "./types";

export interface BranchSelection {
    branchName?: string;
    createNew?: boolean;
    refresh?: boolean;
}

export type BranchQuickPickItem = vscode.QuickPickItem & {
    action?: "create" | "refresh";
    branchName?: string;
};

export function createBranchQuickPickItems(
    catalog: BranchCatalog
): BranchQuickPickItem[] {
    const total = catalog.byRepository.size;
    const branchItems = [...catalog.branches].sort().map((branchName) => {
        let local = 0;
        let remote = 0;
        const missing: string[] = [];

        for (const [key, snapshot] of catalog.byRepository) {
            if (snapshot.local.has(branchName)) {
                local++;
            } else if (snapshot.remote.has(branchName)) {
                remote++;
            } else {
                missing.push(catalog.repositoryNames.get(key) ?? key);
            }
        }

        const available = local + remote;
        const coverage = `${available}/${total} ${total === 1 ? "repo" : "repos"}`;
        const sources = [
            local > 0 ? `${local} local` : undefined,
            remote > 0 ? `${remote} remote` : undefined,
        ].filter(Boolean);

        return {
            label: branchName,
            branchName,
            description: [coverage, ...sources].join(" · "),
            detail: missing.length > 0
                ? `Needs fallback in: ${formatRepositoryNames(missing)}`
                : undefined,
        } satisfies BranchQuickPickItem;
    });

    return [
        { label: "Branches", kind: vscode.QuickPickItemKind.Separator },
        ...branchItems,
        { label: "Actions", kind: vscode.QuickPickItemKind.Separator },
        {
            label: "$(plus) Create New Branches for All Repos",
            description: "Create a new branch in all repositories",
            action: "create",
        },
        {
            label: "$(refresh) Refresh Branch List",
            description: "Refresh refs using the configured remote policy",
            action: "refresh",
        },
    ];
}

export async function showBranchQuickPick(
    catalog: BranchCatalog
): Promise<BranchSelection | undefined> {
    const selected = await vscode.window.showQuickPick(
        createBranchQuickPickItems(catalog),
        {
            placeHolder: 'Select branch or select "create new"',
            ignoreFocusOut: true,
            matchOnDescription: true,
            matchOnDetail: true,
        }
    );

    if (!selected) {
        return undefined;
    }

    if (selected.action === "refresh") {
        return { refresh: true };
    }

    if (selected.action === "create") {
        const newBranchName = await vscode.window.showInputBox({
            prompt: "Enter new branch name",
            placeHolder: "e.g., 1052-ticket-name",
            validateInput: (input) =>
                !input.trim()
                    ? "Branch name cannot be empty"
                    : input.includes(" ")
                    ? "Branch name cannot contain spaces"
                    : null,
        });
        return newBranchName
            ? { branchName: newBranchName, createNew: true }
            : undefined;
    }

    return selected.branchName
        ? { branchName: selected.branchName, createNew: false }
        : undefined;
}

function formatRepositoryNames(names: string[]): string {
    const visible = names.slice(0, 3);
    const remaining = names.length - visible.length;
    return remaining > 0
        ? `${visible.join(", ")} +${remaining} more`
        : visible.join(", ");
}
