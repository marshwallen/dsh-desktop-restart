# 界面维护约定

## 入口与设置

- 唯一重启入口注册在 `sidebar.footer.action`；`settings.section` 仅提供偏好设置。
- 展开侧栏使用 42px 动作行，收起时使用 36×36 图标按钮。
- 宿主的 `footerActions` 默认位于「更多」之前。本插件对所在容器使用 `display: contents`，仅将自身行设为 `order: 1`，排到「更多」之后。
- 该规则依赖宿主布局类名；升级 DSH 时需检查按钮顺序、宽度，以及其他插件的布局。

## 组件与样式

优先使用 `@deepseek-ai/dsh-client-ui-primitives` 的 `Button`、`Switch`、`RiskConfirmation` 和图标；模块不可用时使用本地兜底。

| 项目 | 约定 |
| --- | --- |
| 侧栏行 | 14px/22px、圆角 12px、图标与文字间距 8px |
| 普通按钮 | 36px 高，使用官方 Button 变体 |
| 警告 / 失败 / 成功 | `--dsw-alias-state-warn-primary` / `error-primary` / `success-primary` |
| 交互与焦点 | 官方 `--dsw-alias-interactive-bg-*` 和 `--dsw-focus-ring-*` token |
| 动效 | 遵循 `prefers-reduced-motion` |

## 确认与无障碍

- 普通重启需在 5 秒内点击两次；任务风险使用勾选确认框，兜底警告态有 900ms 冷却。
- 安装或更新期间硬拦，不提供强制确认。
- `aria-label` 仅放短状态词，中文不超过 4 字；详细提示通过 `aria-describedby` 提供，避免皮肤插件将其渲染成行标题。
- 文案注册到宿主 locale 服务；不可用时按浏览器语言回退。

相关宿主源码：`ui-sidebar/SidebarRoot`、`ui-settings-general/SidebarSettings`、`ui-primitives`。
