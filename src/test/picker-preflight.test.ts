import * as assert from "assert";
import * as vscode from "vscode";
import { createBranchQuickPickItems } from "../show-branch-quick-pick";
import { createPreflightSummary } from "../switch-preflight";
import { RepositorySwitchPlan } from "../switch-plan";
import { createRemoteRefresher } from "../remote-refresh";
import { ApiRepository, BranchCatalog } from "../types";

suite("Branch picker and preflight UI model", () => {
    test("uses VS Code Git fetch only when the remote policy allows it", async () => {
        let fetchOptions: unknown;
        const repository = createRepository();
        repository.state.remotes = [{ name: "origin" }];
        repository.fetch = async (options) => {
            fetchOptions = options;
        };

        assert.strictEqual(createRemoteRefresher("Never"), undefined);
        await createRemoteRefresher("When Cache Expires")!(repository);
        assert.deepStrictEqual(fetchOptions, { remote: "origin" });

        fetchOptions = undefined;
        repository.state.remotes = [];
        await createRemoteRefresher("Always")!(repository);
        assert.strictEqual(fetchOptions, undefined);
    });
    test("shows local, remote, and fallback coverage without double counting", () => {
        const catalog: BranchCatalog = {
            branches: new Set(["everywhere", "partial"]),
            byRepository: new Map([
                ["repo-one", {
                    local: new Set(["everywhere", "partial"]),
                    remote: new Set(["everywhere"]),
                }],
                ["repo-two", {
                    local: new Set(),
                    remote: new Set(["everywhere"]),
                }],
            ]),
            repositoryNames: new Map([
                ["repo-one", "repo-one"],
                ["repo-two", "repo-two"],
            ]),
            repositoryRevision: new Map([
                ["repo-one", 0],
                ["repo-two", 0],
            ]),
            staleRepositories: [],
            remoteRefreshFailures: [],
        };

        const items = createBranchQuickPickItems(catalog);
        const everywhere = items.find((item) => item.branchName === "everywhere");
        const partial = items.find((item) => item.branchName === "partial");
        assert.strictEqual(
            everywhere?.description,
            "2/2 repos · 1 local · 1 remote"
        );
        assert.strictEqual(everywhere?.detail, undefined);
        assert.strictEqual(partial?.description, "1/2 repos · 1 local");
        assert.strictEqual(partial?.detail, "Needs fallback in: repo-two");
        assert.strictEqual(
            items.filter((item) => item.kind === vscode.QuickPickItemKind.Separator).length,
            2
        );
    });

    test("summarizes ready, fallback, blocked, and long repository sets", () => {
        const repository = createRepository();
        const plans: RepositorySwitchPlan[] = [
            {
                repository,
                repositoryName: "ready",
                repositoryPath: "ready",
                requestedBranch: "feature",
                targetBranch: "feature",
                source: "local",
                reason: "selected-local",
            },
            {
                repository,
                repositoryName: "fallback",
                repositoryPath: "fallback",
                requestedBranch: "feature",
                targetBranch: "main",
                source: "local",
                reason: "fallback",
            },
            {
                repository,
                repositoryName: "blocked",
                repositoryPath: "blocked",
                requestedBranch: "feature",
                blocked: "unsafe",
                blockedMessage: "Uncommitted changes",
            },
        ];
        const summary = createPreflightSummary(plans);
        assert.deepStrictEqual(
            { ready: summary.ready, fallback: summary.fallback, blocked: summary.blocked },
            { ready: 2, fallback: 1, blocked: 1 }
        );
        assert.match(summary.detail, /Fallback fallback: main/);
        assert.match(summary.detail, /Blocked  blocked: Uncommitted changes/);

        const longSummary = createPreflightSummary(
            Array.from({ length: 32 }, (_, index) => ({
                ...plans[0],
                repositoryName: `repo-${index}`,
            }))
        );
        assert.match(longSummary.detail, /…and 2 more repositories$/);
    });
});

function createRepository(): ApiRepository {
    return {
        rootUri: { fsPath: "repo" },
        state: { HEAD: undefined, remotes: [] },
        getRefs: async () => [],
        fetch: async () => undefined,
        pull: async () => undefined,
    };
}
