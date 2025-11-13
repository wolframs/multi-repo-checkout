import * as assert from 'assert';

suite('Prune Stale Branches Test Suite', () => {
    test('Protected branch pattern matching', () => {
        const protectedPatterns = ["^(main|master|develop)$"];
        const protectedRegexes = protectedPatterns.map((pattern) => new RegExp(pattern));

        // Test protected branches
        assert.strictEqual(protectedRegexes[0].test("main"), true);
        assert.strictEqual(protectedRegexes[0].test("master"), true);
        assert.strictEqual(protectedRegexes[0].test("develop"), true);

        // Test non-protected branches
        assert.strictEqual(protectedRegexes[0].test("feature/test"), false);
        assert.strictEqual(protectedRegexes[0].test("main-old"), false);
        assert.strictEqual(protectedRegexes[0].test("main/feature"), false);
    });

    test('Date cutoff calculation', () => {
        const cutoffDays = 14;
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - cutoffDays);

        const oldDate = new Date();
        oldDate.setDate(oldDate.getDate() - 20);
        assert.strictEqual(oldDate < cutoffDate, true, "Old date should be before cutoff");

        const recentDate = new Date();
        recentDate.setDate(recentDate.getDate() - 5);
        assert.strictEqual(recentDate < cutoffDate, false, "Recent date should be after cutoff");
    });

    test('Branch filtering logic - protected branches are skipped', () => {
        const protectedPatterns = ["^(main|master|develop)$", "^release/.*"];
        const protectedRegexes = protectedPatterns.map((pattern) => new RegExp(pattern));

        const branches = [
            { name: "main", lastCommitDate: new Date("2020-01-01") },
            { name: "master", lastCommitDate: new Date("2020-01-01") },
            { name: "develop", lastCommitDate: new Date("2020-01-01") },
            { name: "release/v1.0", lastCommitDate: new Date("2020-01-01") },
            { name: "feature/old-branch", lastCommitDate: new Date("2020-01-01") },
        ];

        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - 14);

        const eligibleForDeletion = branches.filter((branch) => {
            const isProtected = protectedRegexes.some((regex) => regex.test(branch.name));
            return !isProtected && branch.lastCommitDate < cutoffDate;
        });

        // Only feature/old-branch should be eligible (assuming it's older than cutoff)
        assert.strictEqual(eligibleForDeletion.length, 1);
        assert.strictEqual(eligibleForDeletion[0].name, "feature/old-branch");
    });

    test('Branch filtering logic - current branch is skipped', () => {
        const protectedPatterns = ["^(main|master|develop)$"];
        const protectedRegexes = protectedPatterns.map((pattern) => new RegExp(pattern));
        const currentBranch = "feature/current-work";

        const branches = [
            { name: "main", lastCommitDate: new Date("2020-01-01") },
            { name: currentBranch, lastCommitDate: new Date("2020-01-01") },
            { name: "feature/old-branch", lastCommitDate: new Date("2020-01-01") },
        ];

        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - 14);

        const eligibleForDeletion = branches.filter((branch) => {
            // Skip current branch
            if (branch.name === currentBranch) {
                return false;
            }
            const isProtected = protectedRegexes.some((regex) => regex.test(branch.name));
            return !isProtected && branch.lastCommitDate < cutoffDate;
        });

        // Current branch should be skipped even if it's old
        assert.strictEqual(eligibleForDeletion.length, 1);
        assert.strictEqual(eligibleForDeletion[0].name, "feature/old-branch");
    });

    test('Git output parsing - branch name and date extraction', () => {
        // Simulate git for-each-ref output format: "branch-name|2024-01-15T10:30:00+00:00"
        const gitOutput = "main|2024-01-15T10:30:00+00:00\nfeature/test|2024-01-20T14:20:00+00:00\n";
        const lines = gitOutput.trim().split("\n").filter((line) => line.length > 0);

        const branches: Array<{ name: string; lastCommitDate: Date }> = [];
        for (const line of lines) {
            const [name, dateStr] = line.split("|");
            if (name && dateStr) {
                const date = new Date(dateStr.trim());
                if (!isNaN(date.getTime())) {
                    branches.push({ name: name.trim(), lastCommitDate: date });
                }
            }
        }

        assert.strictEqual(branches.length, 2);
        assert.strictEqual(branches[0].name, "main");
        assert.strictEqual(branches[1].name, "feature/test");
        assert.strictEqual(branches[0].lastCommitDate instanceof Date, true);
        assert.strictEqual(branches[1].lastCommitDate instanceof Date, true);
    });
});

