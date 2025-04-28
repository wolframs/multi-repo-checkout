import { exec } from "child_process";

/**
 * Returns true if there are
 *   – no modified / staged / untracked files
 *   – no commits ahead of the upstream tracking branch
 */
export async function isRepoClean(repoPath: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
        // 1 – working-tree / index
        exec('git status --porcelain=v1', { cwd: repoPath }, (err, out1) => {
            if (err) { return reject(err); }
            if (out1.trim().length > 0) {              // files changed / untracked
                return resolve(false);
            }

            // 2 – ahead / behind
            exec(
                // quote @{u} so PowerShell treats it literally
                'git rev-list --left-right --count "@{u}...HEAD"',
                { cwd: repoPath },
                (err2, out2) => {
                    if (err2) {
                        // no upstream configured ⇒ treat as dirty
                        return resolve(false);
                    }

                    const [behindStr, aheadStr] = out2.trim().split(/\s+/);
                    const ahead  = parseInt(aheadStr, 10)  || 0;
                    const behind = parseInt(behindStr, 10) || 0;

                    // clean only if nothing to commit/push
                    resolve(ahead === 0);
                }
            );
        });
    });
}