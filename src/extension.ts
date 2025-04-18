import * as vscode from 'vscode';
import { exec } from 'child_process';

export function getConfiguredDefaultBranch(): string {
    const config = vscode.workspace.getConfiguration('multiRepoBranchSwitcher');
    return config.get<string>('defaultBranchName', 'master');
}

interface Git {
    repositories: ApiRepository[];
}

interface ApiRepository {
    root: string;
    getRefs(opts?: { contains?: string }): Promise<Ref[]>;
    checkout(branch: string, createBranch?: boolean): Thenable<void>;
    state: {
        HEAD: Ref | undefined;
    };
}

interface Ref {
    name: string;
    commit?: string;
    type: RefType;
    remote?: string;
}

enum RefType {
    Head,
    RemoteHead,
    Tag
}

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(vscode.commands.registerCommand(
        'multi-repo-branch-switcher.switchBranches',
        async () => {            
            const gitExtension = vscode.extensions.getExtension<{ model: Git }>('vscode.git');
            if (!gitExtension) {
                vscode.window.showErrorMessage('Unable to load Git extension');
                return;
            };

            const git = gitExtension.isActive ? gitExtension.exports.model : await gitExtension.activate().then(() => gitExtension.exports.model);
            if (!git) {
                vscode.window.showErrorMessage('Could not retrieve Git API');
                return;
            }

            const repos = git?.repositories || [];
            if (!repos.length) {
                vscode.window.showInformationMessage('No repositories found');
                return;
            }

            // Collect all unique branch names from all repositories
            let allBranches = new Set<string>();
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Window,
                title: '$(git-fetch) Collecting repository refs',
                cancellable: false
            }, async (progress) => {
                allBranches = await collectAllBranches(repos, progress);
            });

            // Show branch selection quick pick
            const branchName = await showBranchQuickPick(allBranches);
            if (!branchName) { return; };

            // Process all repositories
            const createNewBranch = branchName.startsWith('$(plus)');
            const branchNameWithoutPlus = createNewBranch ? branchName.substring('$(plus)'.length) : branchName;

            let finalResults: string[] = [];
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Switching branches`,
                cancellable: false
            }, async (progress) => {
                finalResults = await processRepositories(
                    repos,
                    branchNameWithoutPlus,
                    createNewBranch,
                    progress
                );
            });

            showFinalReport(finalResults);
        }
    ));
}

async function collectAllBranches(
    repos: ApiRepository[],
    progress: vscode.Progress<{ message?: string; increment?: number }>
): Promise<Set<string>> {
    const allBranches = new Set<string>();
    const total = repos.length;
    let completed = 1;

    for (const repo of repos) {
        progress.report({
            message: `Collecting from ${repo.root.split('\\').pop()}...`,
            increment: (completed / total) * 100
        });

        for (const repo of repos) {
            const refs = await repo.getRefs();
            if (!repo.getRefs) {
                vscode.window.showErrorMessage(`Unable to get refs from repository ${repo.root.split('\\').pop()}`);
            }
            refs.forEach((ref: Ref) => {
                if (ref.type === RefType.Head) {
                    allBranches.add(ref.name);
                }
                if (ref.type === RefType.RemoteHead && ref.remote === 'origin') {
                    allBranches.add(ref.name.substring('origin/'.length));
                }
            });
        }
        completed++;
    }
    return allBranches;
}

async function showBranchQuickPick(allBranches: Set<string>): Promise<string | undefined> {
    const branchItems: vscode.QuickPickItem[] = Array.from(allBranches)
        .sort()
        .map(branch => ({ label: branch }));

    const newBranchesLbl = '$(plus) Create New Branches for All Repos';

    branchItems.push({
        label: newBranchesLbl,
        description: 'Create a new branch in all repositories'
    });

    const selected = await vscode.window.showQuickPick(branchItems, {
        placeHolder: 'Select branch or select "create new"',
        ignoreFocusOut: true
    });

    if (!selected) { return undefined; }

    if (selected.label === newBranchesLbl) {
        const newBranchName = await vscode.window.showInputBox({
            prompt: 'Enter new branch name',
            placeHolder: 'e.g., 1052-ticket-name',
            validateInput: input => input.includes(' ') ?
                'Branch name cannot contain spaces' : null
        });
        return '$(plus)' + newBranchName;
    }

    return selected.label;
}

async function processRepositories(
    repos: ApiRepository[],
    branchName: string,
    doCreateNewBranch: boolean,
    progress: vscode.Progress<{ message?: string; increment?: number }>
): Promise<string[]> {
    const results: string[] = [];
    const total = repos.length;
    let completed = 1;

    for (const repo of repos) {
        const repoPath = repo.root;
        const repoName = repoPath.split('\\').pop();

        progress.report({
            message: `${repoName}`,
            increment: (completed / total) * 100
        });

        try {
            const [localExists, remoteExists] = await Promise.all([
                checkBranchExists(repoPath, branchName, 'local'),
                checkBranchExists(repoPath, branchName, 'remote')
            ]);

            if (localExists) {
                await checkoutBranch(repoPath, branchName);
                results.push(`✔ ${repoName}: Switched to existing local branch`);
            } else if (remoteExists) {
                await checkoutRemoteBranch(repoPath, branchName);
                results.push(`✔ ${repoName}: Created local tracking branch from origin`);
            } else {
                if (doCreateNewBranch) {
                    await createBranch(repoPath, branchName);
                    results.push(`✔ ${repoName}: Created new local branch`);
                } else {
                    // Switch to default branch
                    await processRepositories(
                        [repo],
                        getConfiguredDefaultBranch(),
                        false, // not creating new branch
                        progress
                    );
                    results.push(`✔ ${repoName}: Switched to ${getConfiguredDefaultBranch()} branch`);
                }
            }
        } catch (error: any) {
            results.push(`❌ ${repoName}: ${error.message}`);
        }
        completed++;
    }
    return results;
}

async function checkBranchExists(repoPath: string, branch: string, type: 'local' | 'remote'): Promise<boolean> {
    const command = type === 'local'
        ? `git show-ref --verify refs/heads/${branch}`
        : `git ls-remote --exit-code --heads origin ${branch}`;

    return new Promise((resolve, reject) => {
        exec(command, { cwd: repoPath }, (error, stdout) => {
            if (error) {
                if (error.code === 1 || error.code === 2 || error.code === 128) {
                    resolve(false);
                }
                else {
                    reject(new Error(`Check failed: ${error.message}`));
                }
            } else {
                resolve(true);
            }
        });
    });
}

async function checkoutRemoteBranch(repoPath: string, branch: string): Promise<void> {
    return executeCommand(repoPath, `git checkout --track origin/${branch}`, 'Checkout remote failed');
}

async function checkoutBranch(repoPath: string, branch: string): Promise<void> {
    return executeCommand(repoPath, `git checkout ${branch}`, 'Checkout failed');
}

async function createBranch(repoPath: string, branch: string): Promise<void> {
    return executeCommand(repoPath, `git checkout -b ${branch}`, 'Create branch failed');
}

async function executeCommand(repoPath: string, command: string, errorPrefix: string): Promise<void> {
    return new Promise((resolve, reject) => {
        exec(command, { cwd: repoPath }, (error, stdout, stderr) => {
            if (error) {
                reject(new Error(`${errorPrefix}: ${stderr || error.message}`));
            } else {
                resolve();
            }
        });
    });
}

function showFinalReport(results: string[]): void {
    vscode.window.showInformationMessage(
        `Checkouts complete: ${results.join('. ')}.`,
        { modal: false }
    );
}

export function deactivate() { }