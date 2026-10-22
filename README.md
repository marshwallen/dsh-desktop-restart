# @marshwallen/dsh-desktop-restart

[English](README.en.md) | 简体中文

DeepSeek Harness **Windows 桌面版**重启插件。唯一入口位于左侧边栏「更多」下方，界面支持中英文。

## 安装

从 [Releases](https://github.com/marshwallen/dsh-desktop-restart/releases) 下载 `.tgz`，通过插件管理安装。CLI 管理的 profile 可执行：

```sh
dsh plugin add ./marshwallen-dsh-desktop-restart-0.5.0.tgz
```

安装后手动重启一次应用。由桌面应用独占管理的 profile 需通过应用内插件管理安装。

## 使用

- 点击「重启应用」，5 秒内再次点击确认。
- 有任务运行时，需确认中断风险；插件正在安装或更新时禁止重启。
- 重启完成后，按钮提示显示完成时间和停机时长。

在设置中的「重启桌面应用」分区管理可选功能，默认均关闭：

| 功能 | 说明 |
| --- | --- |
| 自动续跑 | 恢复被重启中断的活跃会话，每次最多 8 个；会额外消耗 token |
| 快照清理 | 清理启动前创建、启动后未写入且至少 24 小时的临时快照；支持手动清理 |
| 隐藏意见反馈 | 隐藏账号菜单中的反馈项，关闭后立即恢复 |

## 配置

插件 `config` 支持以下默认值；设置页保存的续跑和清理选项优先：

```yaml
enabled: true
resume: off       # off / notice（仅写入提示）/ wake（自动续跑）
sweep: false
platformAuth: true
```

## 安全与限制

- 重启和设置写入仅接受本机可信页面的 POST，并接入宿主平台鉴权。
- 重启会结束 Electron 主进程；host 通常优雅关闭，端口卡住时才强制结束，可能导致会话日志不完整。
- 多实例环境中，闲置超过 24 小时的其他会话快照可能被误清理，影响改动对比，不删除项目文件。
- 续跑依赖的宿主模块不可用时会跳过恢复。

设置、重启回执和 helper 日志保存在 `$DSH_HOME/desktop-restart/`，默认位于 `~/.dsh/desktop-restart/`。

## 开发与发布

```sh
npm ci
npm run build
npm test
npm run smoke:archive
```

测试使用临时目录和替身进程，不重启真实应用；Windows 专用用例在其他平台跳过。

CI 覆盖 Linux/Windows × Node 22.19.0/24。推送与包版本一致的 `v*` 标签后，验证并发布附带 `.tgz` 的 GitHub Release；不自动发布 npm。

[界面维护约定](docs/official-ui-standard.md)

## 来源与许可证

由 [luoshuizhiwei/dsh-desktop-restart](https://github.com/luoshuizhiwei/dsh-desktop-restart) 修改，marshwallen 维护。保留原作者署名，采用 [MIT](LICENSE) 许可证。
