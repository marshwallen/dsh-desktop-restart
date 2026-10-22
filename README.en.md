# @marshwallen/dsh-desktop-restart

English | [简体中文](README.md)

Restart plugin for **DeepSeek Harness on Windows desktop**. Its only entry sits below **More** in the left sidebar. UI text follows the app's Chinese or English language setting.

## Install

Download the `.tgz` from [Releases](https://github.com/marshwallen/dsh-desktop-restart/releases) and install it through plugin management. For a CLI-managed profile:

```sh
dsh plugin add ./marshwallen-dsh-desktop-restart-0.5.0.tgz
```

Restart the app manually once after installation. Profiles managed exclusively by the desktop app require its built-in plugin manager.

## Usage

- Click **Restart**, then click again within five seconds to confirm.
- Running tasks require explicit risk confirmation. Plugin installations and updates block restart.
- After restarting, the button tooltip shows the completion time and downtime.

The **Restart Desktop App** settings section contains optional features, all disabled by default:

| Feature | Behavior |
| --- | --- |
| Session resume | Resumes up to eight interrupted active sessions; consumes additional tokens |
| Snapshot cleanup | Removes temporary snapshots created before startup, unchanged since startup, and at least 24 hours old; supports manual cleanup |
| Hide Feedback | Hides the account menu's Feedback item; disabling restores it immediately |

## Configuration

Plugin `config` provides these defaults. Resume and cleanup preferences saved through settings take precedence:

```yaml
enabled: true
resume: off       # off / notice (context only) / wake (resume work)
sweep: false
platformAuth: true
```

## Security model

Restart and settings writes accept POST requests from trusted local pages and use the host's platform authentication.

## Known limitations

- Restart ends the Electron main process. The host normally shuts down gracefully; a stuck port can require terminating it, leaving incomplete session logs.
- Cleanup can remove snapshots belonging to another instance idle for over 24 hours. This affects change comparisons, not project files.
- Resume is skipped if the required host modules are unavailable.

Settings, restart receipts, and helper logs live in `$DSH_HOME/desktop-restart/`, defaulting to `~/.dsh/desktop-restart/`.

## Development and releases

```sh
npm ci
npm run build
npm test
npm run smoke:archive
```

Tests use temporary directories and stand-in processes without restarting a real app. Windows-only checks are skipped elsewhere.

CI covers Linux/Windows × Node 22.19.0/24. Pushing a `v*` tag matching the package version verifies the package and creates a GitHub Release with a `.tgz` attachment. It does not publish to npm.

[UI maintenance notes](docs/official-ui-standard.md)

## Credits and license

Modified from [luoshuizhiwei/dsh-desktop-restart](https://github.com/luoshuizhiwei/dsh-desktop-restart), maintained by marshwallen. Original attribution is preserved under the [MIT license](LICENSE).
