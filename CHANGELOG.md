# Change Log

All notable changes to the "multi-repo-checkout" extension will be documented in this file.

## Released

### [Unreleased]

### [0.4.0] - 2026-09-17

- Performance: Refresh cached refs in the background at a configurable interval (300 seconds by default), respecting the remote fetch policy
- Configuration: Increase the default required cache rebuild age to 86,400 seconds (one day); keep zero as refresh-on-every-switch
- UI: Show ref loading and refreshing as a progress notification with a repository count instead of a status-bar item, so a slow load is visible
- Fix: Share a ref load between the background refresh and the branch picker without letting either one's cancellation abort the other
- Fix: Evict a ref load abandoned by every caller so the next one starts fresh instead of inheriting its cancellation
- Fix: Keep refs discovered by a background refresh when persisting the branches a switch created
- Fix: Order cache writes by a monotonic entry revision rather than a wall-clock timestamp, so an out-of-order or same-millisecond write is still detected
- Fix: Reschedule the background refresh only for the settings that govern the timer, and leave a run already under way untouched
- Logging: Report background refresh failures in their own timestamped output channel instead of the Results channel, which is cleared on every switch
- Logging: Report Git repository discovery failures in the background channel, once per outage and once on recovery
- Logging: Log every background failure kind on change only, with one line on recovery, so an offline session does not fill the channel every interval
- Tests: Cover background fetch discovery, cache reuse, settings changes, retry, cancellation, and expiry with real Git repositories

### [0.3.1] - 2026-08-25

- Documentation: Replace retired Visual Studio Marketplace badge endpoints with the supported provider and align all README badge styling
- Packaging: Keep local memory and agent-instruction files out of published VSIX packages

### [0.3.0] - 2026-08-25

- Performance: Cache local and `origin` remote-tracking refs per workspace with a configurable TTL
- Performance: Query refs and process repositories concurrently with a configurable limit
- Performance: Remove per-repository `ls-remote` calls from branch switching and default-branch detection
- Feature: Refresh cached branch refs from the branch picker or Command Palette
- Feature: Add configurable `origin` refresh policies, defaulting to `When Cache Expires`, with non-blocking per-repository failure handling
- Feature: Show local, remote, and fallback repository coverage in the branch picker
- Feature: Add optional preflight confirmation with post-confirmation safety revalidation
- UX: Replace inline repository result dumps with compact counts and an Output-channel **Show Details** action
- UX: Redesign the README with a new hero, current screenshots, Marketplace badges, and clearer workflow documentation
- Robustness: Preserve stale cached refs after transient Git failures, honor refresh cancellation, and recheck refs that change after catalog creation
- Maintenance: Use the supported VS Code Git API and argument-safe Git commands
- Tests: Add real-repository coverage for cache reuse, forced refresh, remote failure, cancellation, preflight races, and offline switching

### [0.2.0]
- Feature [Delete stale local branches with date cutoff](https://github.com/wolframs/multi-repo-checkout/issues/8)
  - New command: "Multi-Repo Branch Switcher: Delete Stale Local Branches"
  - Configurable cutoff days (default: 14 days)
  - Protected branch patterns to prevent deletion of important branches
  - Dry-run mode for previewing deletions
  - Skips repositories with uncommitted changes
- Feature [Quick switch to default branch](https://github.com/wolframs/multi-repo-checkout/issues/9)
  - New command: "Multi-Repo Branch Switcher: Switch to Default Branch"
  - Fast path without enumerating all refs
  - Automatic detection of default branch from remote HEAD or common names
  - Handles remote-only branches by creating tracking branches
- Bugfix [Reload prompt appears only after pull completion](https://github.com/wolframs/multi-repo-checkout/issues/12)
  - Reload window prompt now waits for all pull operations to complete
  - Added settling delay to ensure source control is ready before prompting

### [0.1.8]
- Enhancement [Auto Pull after checkout if possible](https://github.com/wolframs/multi-repo-checkout/issues/10)
- Move functional code out of extension.ts to separate .ts files

### [0.1.7]
- Enhancement [Add screenshots / gif of functionality to README.md](https://github.com/wolframs/multi-repo-checkout/issues/3)

### [0.1.6]
- Feature [Auto reload window after successful checkouts (with settings flag)](https://github.com/wolframs/multi-repo-checkout/issues/2)
- Added configuration to configure "Registering changes..." delay

### [0.1.5]
- Bugfix [Progress indication not accurate when checking out repo branches](https://github.com/wolframs/multi-repo-checkout/issues/4)
- Added SCM Progress Indicator

### [0.1.4]
- Better repo cleanliness check

### [0.1.3]
- Bugfix: [Branch switching "successful", although working tree is dirty and repo branch does not actually get checked out](https://github.com/wolframs/multi-repo-checkout/issues/1)

### [0.1.2]
- Readme adjustments for Extension Store
  
### [0.1.1]
- Proper package, icon
- Progress indication
  
### [0.0.1]
- Initial release
