# Multi-Repo Branch Switcher

This VS Code extension allows you to quickly switch or create branches across all repositories in a multi-repo workspace.

![Readme Header](https://raw.githubusercontent.com/wolframs/multi-repo-checkout/refs/heads/main/img/readme-header.png)

## Features

- **Branch Switching**: Select any existing branch to check out simultaneously across all repositories.
- **Fallback to Default Branch**: If a local/remote branch doesn't exist, the extension checks out the user-defined default branch in that repository.
- **Branch Creation**: Create a new branch in every repository at once.
- **Configurable Default Branch**: Define your preferred default branch name (e.g. `main` or `master`) in VS Code settings.
- **Auto Reload Window**: Automatically reload the window after successful branch switches, get asked whether to do so or disabled.

## Usage

1. Press <kbd>Ctrl+Shift+P</kbd> or <kbd>F1</kbd> (Windows/Linux) or <kbd>Cmd+Shift+P</kbd> (macOS) to open the Command Palette.
   ![usage 1](https://raw.githubusercontent.com/wolframs/multi-repo-checkout/refs/heads/main/img/usage-1.png)

2. Run **Multi-Repo Branch Switcher: Switch Branches**.
   - The extension will get info on all local and remote branches of all repositories.

3. Choose an existing branch from the list or select **Create New Branches for All Repos** to define a new branch name.
   - ![usage 2](https://raw.githubusercontent.com/wolframs/multi-repo-checkout/refs/heads/main/img/usage-2.png)
   - You can filter the branches by typing in the command palette input:
   - ![usage 3](https://raw.githubusercontent.com/wolframs/multi-repo-checkout/refs/heads/main/img/usage-3.png)

4. For each repository, the extension will:
   - Check out the branch if it already exists locally.
   - Check out a remote-tracking branch if it exists on `origin`.
   - Otherwise, it will fall back to the configured default branch.

5. Choose whether to auto reload the window, if so configured.
   - ![usage 3](https://raw.githubusercontent.com/wolframs/multi-repo-checkout/refs/heads/main/img/usage-complete.png)

## Configuration

Open your VS Code settings (`Settings → Extensions → Multi Repo Branch Switcher` or in `settings.json`) and set:

![Settings Screenshot](https://raw.githubusercontent.com/wolframs/multi-repo-checkout/refs/heads/main/img/settings.png)

```json
{
  "multiRepoBranchSwitcher.defaultBranchName": "main",
  "multiRepoBranchSwitcher.registerChangesDelay": 1500,
  "multiRepoBranchSwitcher.autoReloadWindow": "Ask", // "Always", "Never"
}
```
By default, the default branch is `"master"`, but you can override it based on your workflow.



## Feedback & Contributing

Feel free to open an issue or pull request on the repository if you encounter a problem or have a suggestion.

Happy coding!


## Manual VSIX Installation

1. Download the most recent [release](https://github.com/wolframs/multi-repo-checkout/releases/).
2. Go to your VS Code Extensions.
3. Open the "More Actions..." menu:
![image](https://github.com/user-attachments/assets/f23643d9-02b5-4e7d-af21-8795279df25d)
4. Select "Install from VSIX..." and open the downloaded release file.
