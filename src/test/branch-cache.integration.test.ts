import * as assert from "assert";
import { mkdtemp, rename, rm, writeFile } from "fs/promises";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { BranchCache } from "../branch-cache";
import { runGit } from "../git-commands";
import { processRepositories } from "../process-repositories";
import { createPreflightSummary } from "../switch-preflight";
import { createRepositorySwitchPlans } from "../switch-plan";
import { determineDefaultBranch } from "../switch-to-default-branch";
import { ApiRepository, Ref, RefType } from "../types";

class MemoryMemento implements vscode.Memento {
    private readonly values = new Map<string, unknown>();

    keys(): readonly string[] {
        return [...this.values.keys()];
    }

    get<T>(key: string): T | undefined;
    get<T>(key: string, defaultValue: T): T;
    get<T>(key: string, defaultValue?: T): T | undefined {
        return (this.values.get(key) as T | undefined) ?? defaultValue;
    }

    async update(key: string, value: unknown): Promise<void> {
        if (value === undefined) {
            this.values.delete(key);
        } else {
            this.values.set(key, value);
        }
    }
}

suite("Branch cache and switching integration", () => {
    let tempRoot: string;
    let remotePath: string;
    let seedPath: string;
    let repoPaths: string[];
    let refQueries: number;
    let remoteFetches: number;
    let repositories: ApiRepository[];

    suiteSetup(async function () {
        this.timeout(20_000);
        tempRoot = await mkdtemp(path.join(os.tmpdir(), "multi-repo-switcher-"));
        remotePath = path.join(tempRoot, "remote.git");
        seedPath = path.join(tempRoot, "seed");
        await runGit(undefined, ["init", "--bare", remotePath]);
        await runGit(undefined, ["init", "-b", "main", seedPath]);
        await runGit(seedPath, ["config", "user.email", "integration@example.com"]);
        await runGit(seedPath, ["config", "user.name", "Integration Test"]);
        await writeFile(path.join(seedPath, "README.md"), "integration\n");
        await runGit(seedPath, ["add", "README.md"]);
        await runGit(seedPath, ["commit", "-m", "Initial commit"]);
        await runGit(seedPath, ["remote", "add", "origin", remotePath]);
        await runGit(seedPath, ["push", "-u", "origin", "main"]);
        await runGit(remotePath, ["symbolic-ref", "HEAD", "refs/heads/main"]);
        await runGit(seedPath, ["checkout", "-b", "feature/cache"]);
        await runGit(seedPath, ["push", "-u", "origin", "feature/cache"]);

        repoPaths = [path.join(tempRoot, "repo-one"), path.join(tempRoot, "repo-two")];
        for (const repoPath of repoPaths) {
            await runGit(undefined, ["clone", remotePath, repoPath]);
        }
        refQueries = 0;
        remoteFetches = 0;
        repositories = repoPaths.map(createRepository);
    });

    suiteTeardown(async () => {
        await rm(tempRoot, { recursive: true, force: true });
    });

    test("queries each repository once, persists refs, and refreshes on demand", async () => {
        const cache = new BranchCache(new MemoryMemento());
        const first = await cache.collect(repositories, {
            enabled: true,
            ttlMs: 300_000,
            now: 1_000,
        });
        assert.strictEqual(refQueries, 2);
        assert.ok(first.branches.has("main"));
        assert.ok(first.branches.has("feature/cache"));
        assert.ok(!first.branches.has("HEAD"));

        await cache.collect(repositories, {
            enabled: true,
            ttlMs: 300_000,
            now: 2_000,
        });
        assert.strictEqual(refQueries, 2, "fresh cache should avoid Git ref queries");

        await cache.collect(repositories, {
            enabled: true,
            ttlMs: 0,
            now: 2_000,
        });
        assert.strictEqual(refQueries, 4, "a zero TTL should always query Git refs");

        await runGit(repoPaths[0], ["branch", "new-local-branch"]);
        const refreshed = await cache.collect(repositories, {
            enabled: true,
            ttlMs: 300_000,
            forceRefresh: true,
            now: 3_000,
        });
        assert.strictEqual(refQueries, 6);
        assert.ok(refreshed.branches.has("new-local-branch"));
    });

    test("fetches only when a cache entry is refreshed and discovers remote branches", async () => {
        const cache = new BranchCache(new MemoryMemento());
        await cache.collect(repositories, { enabled: true, ttlMs: 300_000 });
        const fetchesBefore = remoteFetches;

        await runGit(seedPath, ["checkout", "-b", "feature/remote-refresh"]);
        await runGit(seedPath, ["push", "-u", "origin", "feature/remote-refresh"]);
        const stillCached = await cache.collect(repositories, {
            enabled: true,
            ttlMs: 300_000,
            refreshRemote: (repository) => repository.fetch({ remote: "origin" }),
        });
        assert.strictEqual(remoteFetches, fetchesBefore);
        assert.ok(!stillCached.branches.has("feature/remote-refresh"));

        const refreshed = await cache.collect(repositories, {
            enabled: true,
            ttlMs: 300_000,
            forceRefresh: true,
            refreshRemote: (repository) => repository.fetch({ remote: "origin" }),
        });
        assert.strictEqual(remoteFetches, fetchesBefore + repositories.length);
        assert.ok(refreshed.branches.has("feature/remote-refresh"));
        assert.deepStrictEqual(refreshed.remoteRefreshFailures, []);
    });

    test("honors cancellation instead of silently falling back to cached refs", async () => {
        const cache = new BranchCache(new MemoryMemento());
        await cache.collect(repositories, { enabled: true, ttlMs: 300_000 });
        const cancellation = new vscode.CancellationTokenSource();
        cancellation.cancel();

        await assert.rejects(
            cache.collect(repositories, {
                enabled: true,
                ttlMs: 300_000,
                forceRefresh: true,
                cancellationToken: cancellation.token,
            }),
            (error) => error instanceof vscode.CancellationError
        );
        cancellation.dispose();
    });

    test("preflight previews fallback and blocked repositories without changing branches", async () => {
        await runGit(repoPaths[0], ["branch", "partial-branch"]);
        await runGit(repoPaths[1], ["branch", "master"]);
        const cache = new BranchCache(new MemoryMemento());
        const catalog = await cache.collect(repositories, {
            enabled: false,
            ttlMs: 0,
        });
        await writeFile(path.join(repoPaths[1], "dirty.txt"), "dirty\n");

        const plans = await createRepositorySwitchPlans(
            repositories,
            "partial-branch",
            false,
            catalog
        );
        const summary = createPreflightSummary(plans);
        assert.deepStrictEqual(
            { ready: summary.ready, fallback: summary.fallback, blocked: summary.blocked },
            { ready: 1, fallback: 0, blocked: 1 }
        );
        assert.strictEqual(
            await runGit(repoPaths[0], ["branch", "--show-current"]),
            "main"
        );
        await rm(path.join(repoPaths[1], "dirty.txt"));

        const cleanPlans = await createRepositorySwitchPlans(
            repositories,
            "partial-branch",
            false,
            catalog
        );
        const cleanSummary = createPreflightSummary(cleanPlans);
        assert.deepStrictEqual(
            {
                ready: cleanSummary.ready,
                fallback: cleanSummary.fallback,
                blocked: cleanSummary.blocked,
            },
            { ready: 2, fallback: 1, blocked: 0 },
            JSON.stringify(cleanPlans.map((plan) => ({
                repository: plan.repositoryName,
                blocked: plan.blocked,
                message: plan.blockedMessage,
                reason: plan.reason,
            })))
        );
    });

    test("revalidates repository safety after preflight confirmation", async () => {
        const cache = new BranchCache(new MemoryMemento());
        const catalog = await cache.collect(repositories, {
            enabled: false,
            ttlMs: 0,
        });
        const plans = await createRepositorySwitchPlans(
            repositories,
            "main",
            false,
            catalog
        );
        await writeFile(path.join(repoPaths[1], "changed-after-preflight.txt"), "dirty\n");

        const results = await processRepositories(
            repositories,
            "main",
            false,
            undefined,
            catalog,
            plans
        );
        assert.ok(
            results.some((result) => result.includes("changed after preflight")),
            results.join("\n")
        );
        await rm(path.join(repoPaths[1], "changed-after-preflight.txt"));
    });

    test("rechecks refs that appeared after a cached catalog was built", async () => {
        const cache = new BranchCache(new MemoryMemento());
        const catalog = await cache.collect(repositories, {
            enabled: false,
            ttlMs: 0,
        });
        await runGit(repoPaths[0], [
            "update-ref",
            "refs/remotes/origin/late-remote-ref",
            "refs/remotes/origin/main",
        ]);

        const [plan] = await createRepositorySwitchPlans(
            [repositories[0]],
            "late-remote-ref",
            false,
            catalog
        );

        assert.strictEqual(plan.source, "remote");
        assert.strictEqual(plan.reason, "selected-remote");
        assert.ok(
            catalog.byRepository.values().next().value?.remote.has("late-remote-ref")
        );
    });

    test("switches from cached remote-tracking refs without remote access", async () => {
        const state = new MemoryMemento();
        const cache = new BranchCache(state);
        const catalog = await cache.collect(repositories, {
            enabled: true,
            ttlMs: 300_000,
        });
        const offlineRemote = `${remotePath}.offline`;
        await rename(remotePath, offlineRemote);

        const results = await processRepositories(
            repositories,
            "feature/cache",
            false,
            undefined,
            catalog
        );

        assert.ok(results.every((result) => result.startsWith("✅")), results.join("\n"));
        for (const repoPath of repoPaths) {
            assert.strictEqual(
                await runGit(repoPath, ["branch", "--show-current"]),
                "feature/cache"
            );
        }
        await cache.persistLocalChanges(catalog);
        const queriesBeforeReload = refQueries;
        const reloaded = await new BranchCache(state).collect(repositories, {
            enabled: true,
            ttlMs: 300_000,
        });
        assert.strictEqual(refQueries, queriesBeforeReload);
        for (const snapshot of reloaded.byRepository.values()) {
            assert.ok(snapshot.local.has("feature/cache"));
        }
        remotePath = offlineRemote;
    });

    test("resolves the remote default branch using only local refs", async () => {
        const resolved = await determineDefaultBranch(repoPaths[0]);
        assert.strictEqual(resolved.name, "main");
        assert.strictEqual(resolved.source, "local");
    });

    test("falls back to stale entries when a refresh fails", async () => {
        const cache = new BranchCache(new MemoryMemento());
        await cache.collect(repositories, { enabled: true, ttlMs: 300_000 });
        const unavailable = repositories.map((repository) => ({
            ...repository,
            getRefs: async () => {
                throw new Error("temporary Git failure");
            },
        }));

        const fallback = await cache.collect(unavailable, {
            enabled: true,
            ttlMs: 300_000,
            forceRefresh: true,
        });
        assert.deepStrictEqual(
            fallback.staleRepositories.sort(),
            ["repo-one", "repo-two"]
        );
        assert.ok(fallback.branches.has("main"));
    });

    test("keeps local refs usable when remote refresh fails", async () => {
        const cache = new BranchCache(new MemoryMemento());
        const unavailable = repositories.map((repository) => ({
            ...repository,
            fetch: async () => {
                throw new Error("origin is offline");
            },
        }));
        const catalog = await cache.collect(unavailable, {
            enabled: true,
            ttlMs: 300_000,
            refreshRemote: (repository) => repository.fetch({ remote: "origin" }),
        });

        assert.strictEqual(catalog.remoteRefreshFailures.length, 2);
        assert.ok(catalog.branches.has("main"));
        assert.deepStrictEqual(catalog.staleRepositories, []);
    });

    function createRepository(repoPath: string): ApiRepository {
        return {
            rootUri: { fsPath: repoPath },
            state: {
                HEAD: undefined,
                remotes: [{ name: "origin", fetchUrl: remotePath }],
            },
            fetch: async () => {
                remoteFetches++;
                await runGit(repoPath, ["fetch", "origin"]);
            },
            pull: async () => undefined,
            getRefs: async () => {
                refQueries++;
                const output = await runGit(repoPath, [
                    "for-each-ref",
                    "--format=%(refname)|%(objectname)",
                    "refs/heads",
                    "refs/remotes/origin",
                ]);
                return output.split("\n").filter(Boolean).map(parseRef);
            },
        };
    }
});

function parseRef(line: string): Ref {
    const [fullName, commit] = line.split("|");
    if (fullName.startsWith("refs/heads/")) {
        return {
            name: fullName.slice("refs/heads/".length),
            commit,
            type: RefType.Head,
        };
    }
    return {
        name: fullName.slice("refs/remotes/".length),
        commit,
        remote: "origin",
        type: RefType.RemoteHead,
    };
}
