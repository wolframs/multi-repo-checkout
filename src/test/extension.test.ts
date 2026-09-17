import * as assert from "assert";
import * as vscode from "vscode";

suite("Extension integration", () => {
    test("registers every contributed command", async () => {
        const extension = vscode.extensions.getExtension(
            "WolframS.multi-repo-branch-switcher"
        );
        assert.ok(extension, "Extension should be installed in the test host");
        await extension.activate();

        const commands = await vscode.commands.getCommands(true);
        for (const command of [
            "multi-repo-branch-switcher.switchBranches",
            "multi-repo-branch-switcher.switchToDefaultBranch",
            "multi-repo-branch-switcher.deleteStaleBranches",
            "multi-repo-branch-switcher.refreshBranchCache",
        ]) {
            assert.ok(commands.includes(command), `${command} should be registered`);
        }

        const properties = extension.packageJSON.contributes.configuration.properties;
        assert.strictEqual(properties["multiRepoBranchSwitcher.cache.ttlSeconds"].default, 86_400);
        assert.strictEqual(
            properties["multiRepoBranchSwitcher.cache.backgroundRefreshIntervalSeconds"].default,
            300
        );
        assert.ok(extension.packageJSON.activationEvents.includes("onStartupFinished"));
        assert.strictEqual(
            properties["multiRepoBranchSwitcher.preflight.enabled"].default,
            false
        );
        assert.deepStrictEqual(
            properties["multiRepoBranchSwitcher.remoteRefresh.policy"].enum,
            ["Never", "When Cache Expires", "Always"]
        );
        assert.strictEqual(
            properties["multiRepoBranchSwitcher.remoteRefresh.policy"].default,
            "When Cache Expires"
        );
    });
});
