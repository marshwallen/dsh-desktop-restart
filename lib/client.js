// 侧栏重启入口和偏好设置；界面语言跟随宿主。
window.__ModuleLoader__.load({
	// Factory id 必须与 package.json 的 name 一致。
	id: "@marshwallen/dsh-desktop-restart",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const React = require("react");

		// 优先使用官方组件，缺失时使用本地样式和内联确认。
		let UI = null;
		try {
			UI = require("@deepseek-ai/dsh-client-ui-primitives");
		} catch {
			UI = null;
		}
		const OfficialButton = UI && typeof UI.Button === "function" ? UI.Button : null;
		const OfficialRiskConfirmation = UI && typeof UI.RiskConfirmation === "function" ? UI.RiskConfirmation : null;
		const OfficialRefreshIcon = UI && typeof UI.IconRefreshOutlineRegular === "function" ? UI.IconRefreshOutlineRegular : null;
		const OfficialWarningIcon = UI && typeof UI.IconWarningOutlineRegular === "function" ? UI.IconWarningOutlineRegular : null;
		const OfficialSwitch = UI && typeof UI.Switch === "function" ? UI.Switch : null;

		const RESTART_ROUTE = "/dsh-desktop-restart/api/restart";
		const STATUS_ROUTE = "/dsh-desktop-restart/api/status";
		const SWEEP_ROUTE = "/dsh-desktop-restart/api/sweep";

		const PREFS_ROUTE = "/dsh-desktop-restart/api/prefs";

		const CONFIRM_MS = 5000;

		// 警告态冷却，防止连点绕过风险提示。
		const WARN_ARM_MS = 900;

		const SIDEBAR_FOOTER_SLOT = "sidebar.footer.action";

		const SETTINGS_SECTION_SLOT = "settings.section";
		const ID = "dsh-desktop-restart";

		const LOCALE_NS = "dsh-desktop-restart";

		const DICT = {
			zh: {
				pluginName: "重启桌面应用",

				navLabel: "重启应用",
				desktopOnly: "仅在桌面版可用",
				defaultHint: "重启整个 DeepSeek Harness 桌面应用。改了插件或设置、需要重启才生效时用这个。",
				wholeApp: "重启整个 DeepSeek Harness 桌面应用",
				wholeAppTooltip: "重启整个桌面应用（结束当前实例并重新打开）",

				restarting: "重启中…",
				scheduled: "已排程",
				confirmRestart: "确认重启？",
				stillRestart: "仍要重启？",
				wait: "稍等…",
				retry: "重试",
				restart: "重启",

				requestFailed: "请求失败：",
				scheduledRestart: "已排程重启：窗口即将关闭，稍后会自动打开。",
				blockedFallback: "插件正在安装或更新，装完再重启",
				guardFallback: "现在有任务在进行",

				blockedSuffix: "；装完之前不能重启。",
				clickTwiceSuffix: "；点两次仍可重启",
				clickTwiceInterruptSuffix: "；现在点两次仍可重启，但那会打断它们。",
				confirmAgainSuffix: "；点「重启」之后还要再确认一次。",
				restartingPageHint: "正在重启…本页马上会断开。",
				warnAgainHint: " 再点一次「仍要重启？」才会执行。",

				waitAndRestart: "等空闲再重启",
				cancelWaiting: "取消等待",
				waitingScheduled: "已安排：等任务跑完后自动重启。",
				waitingCancelled: "已取消等待；需要时再点重启。",
				waitingSuffix: "；已安排：跑完自动重启。",

				guardTurns: "{n} 项正在生成或运行工具",
				guardQueued: "{n} 个会话有排队消息",
				guardJobs: "{n} 个后台任务在跑",
				guardTasksLine: "有任务在跑（{parts}）",
				guardInstalling: "插件正在安装或更新",
				guardAsk: "。继续重启会打断它们（正在写的文件可能停在半路），确认要继续吗？",
				listSep: "、",
				lineSep: "；",

				riskTitle: "重启桌面应用？",
				riskAck: "我知道这会打断上面列出的工作（正在写的文件可能停在半路）",
				riskCancel: "取消",
				riskClose: "关闭",
				riskConfirm: "仍要重启",

				ariaIdle: "重启应用",
				ariaRestarting: "重启中",
				ariaScheduled: "已排程",
				ariaWarnArmed: "仍要重启",
				ariaWarnWait: "请稍等",
				ariaConfirm: "确认重启",
				ariaError: "重试",

				restartReceipt: "已于 {time} 完成重启（停机 {sec} 秒）",

				resumeLabel: "重启后自动继续被中断的任务",
				resumeOff: "已关闭：重启后不会自动起回合。",
				resumeOn: "已开启：重启后会自动继续被打断的会话。",
				resumeHint: "注意：会额外消耗 token —— 开启后，被中断的会话会自动发起新回合接着做。只影响重启那一刻正在干活、或有排队消息的会话（一次最多 8 个）。",

				setTitle: "重启桌面应用",
				setDesc: "重启按钮固定在左侧边栏「更多」下方；这里管理续跑和附带功能。",

				extrasSubtitle: "附带功能",
				sweepLabel: "清理遗留的改动快照",
				sweepAutoLabel: "启动时自动清理遗留的改动快照",
				sweepRunLabel: "立即清理",
				sweepRunning: "清理中…",
				sweepRunningLine: "正在清理遗留快照…",
				sweepAria: "立即清理一次遗留快照",
				sweepReading: "正在读取当前设置…",
				sweepOn: "已开启：每次启动时清理一次。",
				sweepOff: "已关闭：不会动 Temp 里的任何东西。",
				sweepLastPrefix: "上次清理",
				sweepJustNow: "刚刚清理过",
				sweepJustNowDone: "刚刚清理过。",
				sweepErrorHead: "出错：",
				sweepFailedTail: "，有 {n} 个没能删掉（多半还被占着）。",
				sweepDoneRemoved: "：清掉 {n} 个遗留快照目录，释放 {mb} MB",
				sweepDoneNone: "：扫描 {n} 个目录，没有需要清理的",
				sweepNotOk: "没成功：",
				sweepUnknown: "未知错误",
				sweepDetailA: "DSH 的「改动快照」每开一个会话就在系统 Temp 建一个目录，被硬杀或崩溃时会留下孤儿。",
				sweepDetailB: "只清理「启动之前就存在、启动之后没被写过、而且已经躺够 24 小时」的目录，活动会话的绝不碰。",

				hideContactLabel: "隐藏账号菜单里的「意见反馈」",
				hideContactOn: "已隐藏：账号菜单里只剩「设置」和登录/退出，不会再误点。",
				hideContactOff: "已显示：那一项会照常出现在「设置」下面。",
			},
			en: {
				pluginName: "Restart Desktop App",
				navLabel: "Restart App",
				desktopOnly: "Desktop app only",
				defaultHint: "Restarts the entire DeepSeek Harness desktop app. Use it after changing plugins or settings so they take effect.",
				wholeApp: "Restart the whole DeepSeek Harness desktop app",
				wholeAppTooltip: "Restart the whole desktop app (ends the current instance and opens it again)",
				restarting: "Restarting…",
				scheduled: "Scheduled",
				confirmRestart: "Restart now?",
				stillRestart: "Restart anyway?",
				wait: "Hold on…",
				retry: "Retry",
				restart: "Restart",
				requestFailed: "Request failed: ",
				scheduledRestart: "Restart scheduled: the window will close shortly and reopen by itself.",
				blockedFallback: "A plugin install/update is running; restart again once it finishes",
				guardFallback: "Work is currently in progress",
				blockedSuffix: "; restarting stays blocked until it finishes.",
				clickTwiceSuffix: "; click twice to restart anyway",
				clickTwiceInterruptSuffix: "; you can still click twice to restart, but that would interrupt them.",
				confirmAgainSuffix: "; after clicking Restart you will be asked once more.",
				restartingPageHint: "Restarting… this page is about to disconnect.",
				warnAgainHint: " Click \"Restart anyway?\" once more to proceed.",
				waitAndRestart: "Wait & restart",
				cancelWaiting: "Cancel waiting",
				waitingScheduled: "Scheduled: the restart will run automatically once the running work finishes.",
				waitingCancelled: "Waiting cancelled. Click restart whenever you're ready.",
				waitingSuffix: "; scheduled to restart automatically once they finish.",
				guardTurns: "{n} agents generating or running tools",
				guardQueued: "{n} sessions with queued messages",
				guardJobs: "{n} background jobs running",
				guardTasksLine: "Work in progress ({parts})",
				guardInstalling: "A plugin install/update is running",
				guardAsk: ". Restarting now would interrupt them (files being written may stop halfway). Continue?",
				listSep: ", ",
				lineSep: "; ",
				riskTitle: "Restart the desktop app?",
				riskAck: "I understand this interrupts the work listed above (files being written may be left half-done)",
				riskCancel: "Cancel",
				riskClose: "Close",
				riskConfirm: "Restart anyway",
				ariaIdle: "Restart",
				ariaRestarting: "Restarting",
				ariaScheduled: "Scheduled",
				ariaWarnArmed: "Restart anyway",
				ariaWarnWait: "Hold on",
				ariaConfirm: "Confirm restart",
				ariaError: "Retry",
				restartReceipt: "Restarted at {time} (down {sec}s)",
				resumeLabel: "Auto-continue interrupted work after a restart",
				resumeOff: "Off: a restart never starts a turn by itself.",
				resumeOn: "On: interrupted sessions continue by themselves after a restart.",
				resumeHint: "Note: this spends extra tokens — interrupted sessions start a new turn on their own. Only sessions that were running work or had queued messages at restart time are affected (max 8).",
				setTitle: "Restart Desktop App",
				setDesc: "The restart button is below More in the left sidebar. Manage resume and bundled extras here.",
				extrasSubtitle: "Bundled extras",
				sweepLabel: "Sweep leftover change snapshots",
				sweepAutoLabel: "Sweep leftover snapshots on every start",
				sweepRunLabel: "Sweep now",
				sweepRunning: "Sweeping…",
				sweepRunningLine: "Sweeping leftover snapshots…",
				sweepAria: "Sweep leftover snapshots once now",
				sweepReading: "Reading current settings…",
				sweepOn: "On: swept once on every start.",
				sweepOff: "Off: nothing in Temp is ever touched.",
				sweepLastPrefix: "Last sweep",
				sweepJustNow: "just swept",
				sweepJustNowDone: "Swept just now.",
				sweepErrorHead: " failed: ",
				sweepFailedTail: "; {n} could not be removed (probably still in use).",
				sweepDoneRemoved: ": removed {n} leftover snapshot directories, freeing {mb} MB",
				sweepDoneNone: ": scanned {n} directories, nothing to clean up",
				sweepNotOk: "Did not succeed: ",
				sweepUnknown: "unknown error",
				sweepDetailA: "DSH's change snapshots create a directory in the system Temp folder for every session; hard kills and crashes leave them behind as orphans.",
				sweepDetailB: "Only directories that existed before this start, were never written since, and are at least 24 hours old are swept — active sessions are never touched.",
				hideContactLabel: "Hide \"Feedback\" in the account menu",
				hideContactOn: "Hidden: the account menu keeps only Settings and sign-in/out, so it can't be misclicked.",
				hideContactOff: "Shown: the item reappears below Settings as usual.",
			},
		};

		let t = (key, vars) => {
			let lang = "zh";
			try {
				lang = String(navigator.language || "zh").toLowerCase().startsWith("zh") ? "zh" : "en";
			} catch {}
			const table = DICT[lang] ?? DICT.zh;
			let text = typeof table[key] === "string" ? table[key] : String(key);
			if (vars !== undefined && vars !== null) {
				for (const [name, value] of Object.entries(vars)) {
					text = text.split("{" + name + "}").join(String(value));
				}
			}
			return text;
		};

		function hostMessage(hostText, fallbackKey) {
			const text = String(hostText ?? "");
			if (text === "") return t(fallbackKey);
			return text;
		}

		const HIDE_CONTACT_STORE_KEY = "dsh-desktop-restart.hide-contact";

		// 按宿主菜单的原始文字匹配，不随插件翻译。
		const CONTACT_LABELS = ["意见反馈", "Feedback"];

		const HIDER_ATTR = "data-dshdr-hidden";

		let hiderObserver = null;

		let hideContactOn = readHideContact();

		function readHideContact() {
			try {
				const raw = window.localStorage.getItem(HIDE_CONTACT_STORE_KEY);
				return raw === null ? false : raw !== "0";
			} catch {
				return false;
			}
		}

		function writeHideContact(value) {
			try {
				window.localStorage.setItem(HIDE_CONTACT_STORE_KEY, value === true ? "1" : "0");
			} catch {}
		}

		// 只隐藏精确匹配的菜单项，关闭设置时恢复原样。
		function hideContactIn(root) {
			if (root === null || root === undefined || typeof root.querySelectorAll !== "function") return;
			const found = [];
			if (typeof root.matches === "function" && root.matches("button[role=\"menuitem\"]")) found.push(root);
			for (const item of root.querySelectorAll("button[role=\"menuitem\"]")) found.push(item);
			for (const item of found) {
				const text = (item.textContent || "").trim();
				if (CONTACT_LABELS.indexOf(text) < 0) continue;

				const parent = item.parentElement;
				const wrapper = parent !== null && parent !== undefined
					&& (parent.textContent || "").trim() === text
					&& parent.querySelectorAll("button[role=\"menuitem\"]").length === 1
					? parent
					: item;
				wrapper.style.display = "none";
				wrapper.setAttribute(HIDER_ATTR, "1");
			}
		}

		function startHider() {
			if (typeof document === "undefined" || hiderObserver !== null) return;
			hideContactIn(document.body);
			if (typeof MutationObserver !== "function") return;
			hiderObserver = new MutationObserver((records) => {
				for (const record of records) {
					for (const node of record.addedNodes) {
						if (node.nodeType === 1) hideContactIn(node);
					}
				}
			});
			hiderObserver.observe(document.body, { childList: true, subtree: true });
		}

		function stopHider() {
			if (hiderObserver !== null) {
				hiderObserver.disconnect();
				hiderObserver = null;
			}
			if (typeof document === "undefined") return;
			for (const node of document.querySelectorAll("[" + HIDER_ATTR + "=\"1\"]")) {
				node.style.display = "";
				node.removeAttribute(HIDER_ATTR);
			}
		}

		function setHideContact(value) {
			hideContactOn = value === true;
			writeHideContact(hideContactOn);
			if (hideContactOn) startHider();
			else stopHider();
		}

		const CSS_TAG_ID = ID + "/Client.module.css";

		const CSS = [
			"@keyframes dshdr-spin{to{transform:rotate(360deg)}}",
			".dshdr-foot-badge[data-busy='1'] svg{transform-origin:center;animation:dshdr-spin 1s linear infinite}",
			"@media (prefers-reduced-motion:reduce){.dshdr-foot-badge[data-busy='1'] svg,.dshdr-btn[data-busy='1'] svg,.dshdr-spin{animation:none}}",

			".dshdr-btn{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:4px;height:36px;padding:0 14px;border:none;border-radius:var(--dsw-radius-md,12px);cursor:pointer;font:inherit;font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary,inherit);background:transparent}",
			".dshdr-btn:disabled{cursor:not-allowed;opacity:.4}",
			".dshdr-btn:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,rgba(77,107,254,.75)));outline-offset:2px}",
			".dshdr-btn[data-variant=ghost]:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.18))}",
			".dshdr-btn[data-variant=ghost]:active:not(:disabled){background:var(--dsw-alias-interactive-bg-active,rgba(127,127,127,.22))}",
			".dshdr-btn[data-variant=outline]{border:.5px solid var(--dsw-alias-border-l3,rgba(127,127,127,.35));background:transparent}",
			".dshdr-btn[data-variant=outline]:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.18))}",
			".dshdr-btn[data-variant=primary]{background:var(--dsw-alias-button-primary-fill,rgba(77,107,254,1));color:var(--dsw-alias-label-primary-foreground,#fff)}",
			".dshdr-btn[data-variant=primary]:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover,rgba(77,107,254,.85))}",
			".dshdr-btn[data-tone=warn]{color:var(--dsw-alias-state-warn-primary,#d29922)}",
			".dshdr-btn[data-tone=done]{color:var(--dsw-alias-state-success-primary,#3fb950)}",
			".dshdr-btn[data-tone=error]{color:var(--dsw-alias-state-error-primary,#f85149)}",
			".dshdr-btn[data-busy='1'] svg{transform-origin:center;animation:dshdr-spin 1s linear infinite}",

			".dshdr-foot{order:1;box-sizing:border-box;flex:none;align-items:center;width:calc(100% + 4px);height:42px;margin:4px -2px;display:flex;position:relative}",
			".dshdr-foot-badge{box-sizing:border-box;width:100%;height:42px;color:var(--dsw-alias-label-primary,inherit);cursor:pointer;background:0 0;border:none;border-radius:12px;align-items:center;gap:8px;padding:0 10px 0 8px;font-family:inherit;font-size:14px;line-height:22px;display:flex;overflow:hidden}",
			".dshdr-foot-badge[data-phase=confirm]{color:var(--dsw-alias-label-primary,inherit)}",
			".dshdr-foot-badge:active:not(:disabled){background:var(--dsw-alias-interactive-bg-active,rgba(127,127,127,.22))}",
			".dshdr-foot-badge:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.18))}",
			".dshdr-foot-badge:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,rgba(77,107,254,.75)));outline-offset:2px}",
			".dshdr-foot-badge:disabled{color:var(--dsw-alias-label-tertiary,inherit);cursor:default;background:0 0}",
			".dshdr-foot-label{text-overflow:ellipsis;white-space:nowrap;min-width:0;overflow:hidden}",

			".dshdr-sr-only{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}",
			".dshdr-foot-badge[data-phase=warn]{color:var(--dsw-alias-state-warn-primary,#d29922)}",
			".dshdr-foot-badge[data-phase=error]{color:var(--dsw-alias-state-error-primary,#f85149)}",
			".dshdr-foot-badge[data-phase=done]{color:var(--dsw-alias-state-success-primary,#3fb950)}",
			".dshdr-foot[data-rail='1']{width:36px;height:36px;margin:8px 0 10px}",
			".dshdr-foot[data-rail='1'] .dshdr-foot-badge{border-radius:50%;justify-content:center;gap:0;width:36px;height:36px;padding:0}",
			".dshdr-foot[data-rail='1'] .dshdr-foot-label{display:none}",

			// 展开 footer 布局盒；仅本插件行以 order:1 排到「更多」之后。
			"[class*=\"footerActions\"]:has(.dshdr-foot){display:contents !important}",

			".dshdr-set-page{box-sizing:border-box;display:flex;flex-direction:column;width:100%;max-width:720px;margin:0 auto;padding:24px}",
			".dshdr-set-title{color:var(--dsw-alias-label-primary,inherit);margin:0 0 4px;font-size:16px;font-weight:500;line-height:24px}",
			".dshdr-set-desc{color:var(--dsw-alias-label-secondary,inherit);margin:0;font-size:14px;line-height:22px}",
			".dshdr-set-row{display:flex;align-items:center;gap:12px;padding:16px 0;border-bottom:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.2))}",
			".dshdr-set-text{display:flex;flex-direction:column;flex:1;gap:4px;min-width:0;padding-right:48px}",
			".dshdr-set-label{color:var(--dsw-alias-label-primary,inherit);font-size:14px;font-weight:400;line-height:22px}",
			".dshdr-set-hint{color:var(--dsw-alias-label-tertiary,inherit);font-size:12px;line-height:18px}",
			".dshdr-set-subtitle{color:var(--dsw-alias-label-primary,inherit);margin:24px 0 0;font-size:14px;font-weight:500;line-height:22px}",
			".dshdr-set-actions{display:flex;align-items:center;gap:8px;flex:none}",

			".dshdr-set-result{color:var(--dsw-alias-label-secondary,inherit);display:flex;align-items:center;gap:6px;font-size:13px;line-height:20px}",
			".dshdr-set-result[data-tone=ok]{color:var(--dsw-alias-state-success-primary,#3fb950)}",
			".dshdr-set-result[data-tone=warn]{color:var(--dsw-alias-state-warn-primary,#d29922)}",
			".dshdr-set-result[data-tone=error]{color:var(--dsw-alias-state-error-primary,#f85149)}",

			".dshdr-spin{display:inline-flex;transform-origin:center;animation:dshdr-spin 1s linear infinite}",
		].join("");

		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(CSS_TAG_ID) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = ID;
			tag.dataset.pluginCss = CSS_TAG_ID;
			tag.textContent = CSS;
			document.head.appendChild(tag);
		}

		function Glyph(size) {
			if (OfficialRefreshIcon !== null) return React.createElement(OfficialRefreshIcon, { size: size });
			return React.createElement("svg", {
				width: String(size),
				height: String(size),
				viewBox: "0 0 16 16",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: "1.2",
				strokeLinecap: "round",
				"aria-hidden": "true",
				focusable: "false",
			},
				React.createElement("path", { d: "M13.51 7.03A5.6 5.6 0 1 1 10.8 3.15" }),
				React.createElement("path", { d: "M10.42 1.75L10.97 3.25L9.4 3.53" }));
		}

		function guardHintOf(body) {
			const guard = body !== null && typeof body === "object" && body.guard !== null && typeof body.guard === "object"
				? body.guard
				: {};
			const tasks = guard.tasks !== null && typeof guard.tasks === "object" ? guard.tasks : null;
			const installs = guard.installs !== null && typeof guard.installs === "object" ? guard.installs : null;
			const lines = [];
			if (tasks !== null && tasks.active === true) {
				const parts = [];
				if (Number(tasks.turns) > 0) parts.push(t("guardTurns", { n: Number(tasks.turns) }));
				if (Number(tasks.queued) > 0) parts.push(t("guardQueued", { n: Number(tasks.queued) }));
				if (Number(tasks.jobs) > 0) parts.push(t("guardJobs", { n: Number(tasks.jobs) }));
				if (parts.length > 0) lines.push(t("guardTasksLine", { parts: parts.join(t("listSep")) }));
			}
			if (installs !== null && installs.running === true) lines.push(t("guardInstalling"));
			if (lines.length > 0) return lines.join(t("lineSep"));
			return Array.isArray(guard.reasons) ? guard.reasons.join("；") : "";
		}

		async function fetchStatus() {
			try {
				const response = await fetch(STATUS_ROUTE, { method: "GET" });
				const body = await response.json().catch(() => null);
				if (response.ok && body) {
					return {
						desktop: body.desktop === true,
						guardHint: guardHintOf(body),
						blocked: body.guard !== null && typeof body.guard === "object" && body.guard.blocked === true,
						waiting: body.waiting !== null && typeof body.waiting === "object",

						lastRestart: body.lastRestart !== null && typeof body.lastRestart === "object"
							? {
								at: String(body.lastRestart.at ?? ""),
								downtimeMs: Number(body.lastRestart.downtimeMs) || 0,
								sessions: Number(body.lastRestart.sessions) || 0,
							}
							: null,

						resume: typeof body.resume === "string" ? body.resume : undefined,

						sweep: body.sweep !== null && typeof body.sweep === "object" ? body.sweep : undefined,
					};
				}
				return { desktop: false, guardHint: "", blocked: false, waiting: false, lastRestart: null, sweep: undefined };
			} catch {
				return { desktop: false, guardHint: "", blocked: false, waiting: false, lastRestart: null, sweep: undefined };
			}
		}

		async function requestRestart(options = {}) {
			// 桌面壳转发不保证保留请求体，控制参数使用查询串。
			const params = [];
			if (options.force === true) params.push("force=1");
			if (options.wait === true) params.push("wait=1");
			if (options.cancelWait === true) params.push("cancelWait=1");
			const query = params.length > 0 ? "?" + params.join("&") : "";
			let response;
			try {
				response = await fetch(RESTART_ROUTE + query, { method: "POST" });
			} catch (error) {
				return { ok: false, text: t("requestFailed") + String((error && error.message) || error) };
			}
			const body = await response.json().catch(() => null);
			if (response.ok && body && body.ok === true) {
				if (body.waiting === true) return { ok: true, waiting: true, text: t("waitingScheduled") };
				if (body.cancelled !== undefined) return { ok: true, cancelled: body.cancelled, text: t("waitingCancelled") };
				return {
					ok: true,
					text: t("scheduledRestart"),
				};
			}
			if (body && body.blocked === true) {
				return {
					ok: false,
					blocked: true,
					text: hostMessage(body.error, "blockedFallback"),
				};
			}
			if (body && body.guard && body.guard.active === true) {
				return { ok: false, guard: true, text: hostMessage(body.error, "guardFallback") };
			}
			return { ok: false, text: String((body && body.error) || ("HTTP " + response.status)) };
		}

		function labelOf(action) {
			if (action.phase === "restarting") return t("restarting");
			if (action.phase === "done") return t("scheduled");
			if (action.phase === "warn") return action.armed ? t("stillRestart") : t("wait");
			if (action.phase === "confirm") return t("confirmRestart");
			if (action.phase === "error") return t("retry");
			return t("restart");
		}

		// 皮肤插件可能把 aria-label 当可见标题；这里只放短状态词。
		function ariaLabelOf(action) {
			if (action.desktop === false) return t("ariaIdle");
			if (action.phase === "restarting") return t("ariaRestarting");
			if (action.phase === "done") return t("ariaScheduled");
			if (action.phase === "warn") return action.armed ? t("ariaWarnArmed") : t("ariaWarnWait");
			if (action.phase === "confirm") return t("ariaConfirm");
			if (action.phase === "error") return t("ariaError");
			return t("ariaIdle");
		}

		// 详细状态放在 aria-describedby 指向的隐藏文本中。
		function ariaDescriptionOf(action) {
			if (action.guardHint === "") return action.restart !== null ? restartReceiptText(action.restart) : "";
			if (action.blocked === true) return action.guardHint + t("blockedSuffix");
			if (action.waiting === true) return action.guardHint + t("waitingSuffix");
			return action.guardHint + t("clickTwiceSuffix");
		}

		let hintSeq = 0;
		function useHintId() {
			const ref = React.useRef(null);
			if (ref.current === null) {
				hintSeq += 1;
				ref.current = "dshdr-hint-" + String(hintSeq);
			}
			return ref.current;
		}

		function restartReceiptText(restart) {
			const at = new Date(String(restart?.at ?? ""));
			const time = Number.isNaN(at.getTime())
				? "—"
				: [at.getHours(), at.getMinutes(), at.getSeconds()]
					.map((n) => String(n).padStart(2, "0"))
					.join(":");
			const sec = Math.max(0, Math.round((Number(restart?.downtimeMs) || 0) / 1000));
			return t("restartReceipt", { time, sec });
		}

		function toneOf(action) {
			if (action.phase === "error") return "error";
			if (action.phase === "done") return "ok";
			if (action.phase === "warn") return "warn";
			return "plain";
		}

		function useRestart(timer) {
			const phasePair = React.useState("idle");
			const phase = phasePair[0];
			const setPhase = phasePair[1];
			const messagePair = React.useState("");
			const message = messagePair[0];
			const setMessage = messagePair[1];
			const desktopPair = React.useState(null);
			const desktop = desktopPair[0];
			const setDesktop = desktopPair[1];
			const hintPair = React.useState("");
			const guardHint = hintPair[0];
			const setGuardHint = hintPair[1];
			const armedPair = React.useState(false);
			const armed = armedPair[0];
			const setArmed = armedPair[1];

			const modalOpenPair = React.useState(false);
			const modalOpen = modalOpenPair[0];
			const setModalOpen = modalOpenPair[1];
			const ackPair = React.useState(false);
			const acknowledged = ackPair[0];
			const setAcknowledged = ackPair[1];
			const guardTextPair = React.useState("");
			const guardText = guardTextPair[0];
			const setGuardText = guardTextPair[1];

			const blockedPair = React.useState(false);
			const blocked = blockedPair[0];
			const setBlocked = blockedPair[1];

			const waitingPair = React.useState(false);
			const waiting = waitingPair[0];
			const setWaiting = waitingPair[1];

			const restartPair = React.useState(null);
			const restart = restartPair[0];
			const setRestart = restartPair[1];

			const hasTimer = timer !== undefined && typeof timer.timeout === "function";

			const armLater = (fn, ms) => {
				if (hasTimer) timer.timeout(fn, ms);
				else fn();
			};

			const expireLater = (fn, ms) => {
				if (hasTimer) timer.timeout(fn, ms);
			};

			const refresh = () => {
				fetchStatus().then((status) => {
					setDesktop(status.desktop);
					setGuardHint(status.guardHint);
					setBlocked(status.blocked === true);
					setWaiting(status.waiting === true);
					setRestart(status.lastRestart ?? null);
				}, () => {});
			};

			React.useEffect(() => {
				let live = true;
				fetchStatus().then((status) => {
					if (!live) return;
					setDesktop(status.desktop);
					setGuardHint(status.guardHint);
					setBlocked(status.blocked === true);
					setWaiting(status.waiting === true);
					setRestart(status.lastRestart ?? null);
				}, () => {
					if (live) setDesktop(false);
				});
				return () => { live = false; };
			}, []);

			const send = (options) => {
				setPhase("restarting");
				setMessage("");
				requestRestart(options).then((result) => {
					if (result.ok) {
						if (result.waiting === true) {
							setWaiting(true);
							setPhase("idle");
							setMessage(result.text);
							return;
						}
						if (result.cancelled !== undefined) {
							setWaiting(false);
							setPhase("idle");
							setMessage(result.text);
							return;
						}
						setPhase("done");
						setMessage(result.text);
						return;
					}
					// 安装中属于硬拦，不提供强制重启确认。
					if (result.blocked === true) {
						setBlocked(true);
						setPhase("error");
						setMessage(result.text);
						return;
					}
					if (result.guard === true) {
						if (OfficialRiskConfirmation !== null) {
							setGuardText(result.text);
							setAcknowledged(false);
							setModalOpen(true);
							setPhase("idle");
							return;
						}
						setPhase("warn");
						setMessage(result.text);
						setArmed(false);
						armLater(() => setArmed(true), WARN_ARM_MS);
						return;
					}
					setPhase("error");
					setMessage(result.text);
				}, (failure) => {
					setPhase("error");
					setMessage(String((failure && failure.message) || failure));
				});
			};

			const waitForIdle = () => {
				send({ wait: true });
			};

			const cancelWait = () => {
				send({ cancelWait: true });
			};

			const press = () => {
				if (phase === "restarting" || desktop === false || phase === "done") return;
				if (phase === "warn") {
					if (armed) send({ force: true });
					return;
				}
				if (phase === "error") {
					send({});
					return;
				}
				if (phase !== "confirm") {
					setPhase("confirm");
					expireLater(() => setPhase((current) => (current === "confirm" ? "idle" : current)), CONFIRM_MS);
					return;
				}
				send({});
			};

			const cancelModal = () => {
				setModalOpen(false);
				setAcknowledged(false);
				setPhase("idle");
			};

			// 只有风险确认或警告态操作才发送 force。
			const confirmModal = () => {
				setModalOpen(false);
				setAcknowledged(false);
				send({ force: true });
			};

			return {
				phase, message, desktop, guardHint, blocked, waiting, restart, armed, press, refresh, waitForIdle, cancelWait,
				modal: {
					open: modalOpen,
					acknowledged: acknowledged,
					text: guardText,
					setAcknowledged: setAcknowledged,
					cancel: cancelModal,
					confirm: confirmModal,
				},
			};
		}

		function RiskDialog(action) {
			if (OfficialRiskConfirmation === null || action.modal.open !== true) return null;
			return React.createElement(OfficialRiskConfirmation, {
				open: true,
				title: t("riskTitle"),
				description: action.modal.text,
				acknowledgeLabel: t("riskAck"),
				cancelLabel: t("riskCancel"),
				closeLabel: t("riskClose"),
				confirmLabel: t("riskConfirm"),
				acknowledged: action.modal.acknowledged,
				onAcknowledgedChange: action.modal.setAcknowledged,
				onCancel: action.modal.cancel,
				onConfirm: action.modal.confirm,
			});
		}

		function apply(ctx) {
			const slots = ctx.get("slots");
			if (slots === undefined) return;
			const timer = ctx.get("timer");

			try {
				const locale = ctx.locale ?? (typeof ctx.get === "function" ? ctx.get("locale") : undefined);
				if (locale !== undefined && locale !== null
					&& typeof locale.register === "function" && typeof locale.bind === "function") {
					locale.register(LOCALE_NS, DICT);
					const bound = locale.bind(LOCALE_NS);
					if (typeof bound === "function") t = bound;
				}
			} catch {}

			function guardSuffix(action, retryKey) {
				if (action.guardHint === "") return "";
				if (action.blocked === true) return t("blockedSuffix");
				if (action.waiting === true) return t("waitingSuffix");
				return t(retryKey);
			}

			function tooltipOf(action) {
				if (action.message !== "") return action.message;
				if (action.desktop === false) return t("desktopOnly");
				if (action.guardHint !== "") return action.guardHint + guardSuffix(action, "clickTwiceSuffix");
				return t("wholeApp") + (action.restart !== null ? " — " + restartReceiptText(action.restart) : "");
			}

			function isDisabled(action) {
				return action.phase === "restarting"
					|| action.phase === "done"
					|| action.desktop === false
					|| (action.phase === "warn" && action.armed === false);
			}

			function SidebarRestartAction(props) {
				const action = useRestart(timer);
				const wide = !(props !== undefined && props !== null && props.wide === false);
				const busy = action.phase === "restarting";
				const title = tooltipOf(action);

				const described = ariaDescriptionOf(action);
				const hintId = useHintId();

				return React.createElement(React.Fragment, null,
					React.createElement("div", { className: "dshdr-foot", "data-rail": wide ? "0" : "1" },
						React.createElement("button", {
							type: "button",
							className: "dshdr-foot-badge",
							"data-phase": action.phase,
							"data-busy": busy ? "1" : "0",
							disabled: isDisabled(action),
							title: title,
							"aria-label": ariaLabelOf(action),
							"aria-describedby": described === "" ? undefined : hintId,
							"aria-busy": busy ? "true" : undefined,
							"aria-live": "polite",
							onClick: action.press,
							onMouseEnter: action.refresh,
							onFocus: action.refresh,
						},
							Glyph(16),
							React.createElement("span", { className: "dshdr-foot-label" }, labelOf(action)))),
					described !== "" && React.createElement("span", { id: hintId, className: "dshdr-sr-only" }, described),
					RiskDialog(action));
			}

			function HideContactRow() {
				const countPair = React.useState(0);
				const bump = countPair[1];
				const on = hideContactOn === true;

				const toggle = (next) => {
					setHideContact(typeof next === "boolean" ? next : !on);
					bump((n) => n + 1);
				};
				const label = t("hideContactLabel");
				const control = OfficialSwitch !== null
					? React.createElement(OfficialSwitch, {
						checked: on,
						onChange: toggle,
						label: label,
					})
					: React.createElement("input", {
						type: "checkbox",
						checked: on,
						"aria-label": label,
						onChange: (event) => { toggle(event.target.checked); },
					});
				return React.createElement("div", { className: "dshdr-set-row" },
					React.createElement("span", { className: "dshdr-set-text" },
						React.createElement("span", { className: "dshdr-set-label" }, label),
						React.createElement("span", { className: "dshdr-set-hint", "aria-live": "polite" },
							on ? t("hideContactOn") : t("hideContactOff"))),
					React.createElement("span", { className: "dshdr-set-actions" }, control));
			}

			// 续跑设置存于宿主，默认关闭；开启后可能额外消耗 token。
			function ResumeRow() {
				const modePair = React.useState(null);
				const mode = modePair[0];
				const setMode = modePair[1];
				const busyPair = React.useState(false);
				const busy = busyPair[0];
				const setBusy = busyPair[1];

				React.useEffect(() => {
					let live = true;
					fetchStatus().then((status) => {
						if (live && typeof status.resume === "string") setMode(status.resume);
					}, () => {});
					return () => { live = false; };
				}, []);

				const enabled = mode === "wake" || mode === "notice";

				const toggle = (next) => {
					const on = typeof next === "boolean" ? next : !enabled;
					setBusy(true);
					setMode(on ? "wake" : "off");
					fetch(PREFS_ROUTE + (on ? "?resume=wake" : "?resume=off"), { method: "POST" })
						.then((response) => response.json().catch(() => null))
						.then((body) => {
							if (body && typeof body.resume === "string") setMode(body.resume);
						}, () => {})
						.finally(() => { setBusy(false); });
				};

				const label = t("resumeLabel");
				const control = OfficialSwitch !== null
					? React.createElement(OfficialSwitch, {
						checked: enabled,
						disabled: mode === null || busy,
						onChange: toggle,
						label: label,
					})
					: React.createElement("input", {
						type: "checkbox",
						checked: enabled,
						disabled: mode === null || busy,
						"aria-label": label,
						onChange: (event) => { toggle(event.target.checked); },
					});
				return React.createElement("div", { className: "dshdr-set-row" },
					React.createElement("span", { className: "dshdr-set-text" },
						React.createElement("span", { className: "dshdr-set-label" }, label),
						React.createElement("span", { className: "dshdr-set-hint", "aria-live": "polite" },
							mode === null ? t("sweepReading") : (enabled ? t("resumeOn") : t("resumeOff"))),
						React.createElement("span", { className: "dshdr-set-hint" }, t("resumeHint"))),
					React.createElement("span", { className: "dshdr-set-actions" }, control));
			}

			function SweepRow() {
				const statePair = React.useState(null);
				const sweep = statePair[0];
				const setSweep = statePair[1];
				const busyPair = React.useState(false);
				const busy = busyPair[0];
				const setBusy = busyPair[1];

				const resultPair = React.useState(null);
				const result = resultPair[0];
				const setResult = resultPair[1];

				React.useEffect(() => {
					let live = true;
					fetchStatus().then((status) => {
						if (live && status.sweep !== undefined) setSweep(status.sweep);
					}, () => {});
					return () => { live = false; };
				}, []);

				// 清理回执带时间戳，便于识别连续两次相同的结果。
				const clockOf = (iso) => {
					const at = new Date(String(iso ?? ""));
					if (Number.isNaN(at.getTime())) return "";
					const two = (n) => String(n).padStart(2, "0");
					return " " + two(at.getHours()) + ":" + two(at.getMinutes()) + ":" + two(at.getSeconds());
				};

				const describe = (result, prefixKey) => {
					const head = t(prefixKey ?? "sweepLastPrefix") + clockOf(result.at);
					if (result.error) return head + t("sweepErrorHead") + String(result.error);
					const failed = Number(result.failed || 0);
					const tail = failed > 0 ? t("sweepFailedTail", { n: failed }) : "。";
					if (result.removed > 0) {
						return head + t("sweepDoneRemoved", {
							n: result.removed,
							mb: (Number(result.bytes || 0) / 1048576).toFixed(1),
						}) + tail;
					}
					return head + t("sweepDoneNone", { n: result.scanned ?? 0 }) + tail;
				};

				const toneOf = (result) => {
					if (result.error) return "error";
					return Number(result.failed || 0) > 0 ? "warn" : "ok";
				};

				const call = (query, manual) => {
					setBusy(true);
					if (manual === true) setResult(null);
					fetch(SWEEP_ROUTE + query, { method: "POST" })
						.then((response) => response.json().catch(() => null))
						.then((body) => {
							if (body && body.ok === true) {
								const next = body.last ?? null;
								setSweep({ enabled: body.enabled === true, last: next });

								if (manual === true) {
									setResult(next === null
										? { tone: "ok", text: t("sweepJustNowDone") }
										: { tone: toneOf(next), text: describe(next, "sweepJustNow") });
								}
							} else if (manual === true) {
								setResult({ tone: "error", text: t("sweepNotOk") + String((body && body.error) || t("sweepUnknown")) });
							}
						}, (error) => {
							if (manual === true) {
								setResult({ tone: "error", text: t("requestFailed") + String((error && error.message) || error) });
							}
						})
						.finally(() => { setBusy(false); });
				};

				const enabled = sweep !== null && sweep.enabled === true;
				const last = sweep !== null && sweep.last ? sweep.last : null;
				let hint;
				if (sweep === null) hint = t("sweepReading");
				else if (last !== null) hint = describe(last);
				else if (enabled) hint = t("sweepOn");
				else hint = t("sweepOff");

				const detail = t("sweepDetailA") + t("sweepDetailB");

				const toggle = (next) => {
					const on = typeof next === "boolean" ? next : enabled !== true;
					call(on ? "?enabled=1" : "?enabled=0", false);
				};
				const control = OfficialSwitch !== null
					? React.createElement(OfficialSwitch, {
						checked: enabled,
						disabled: sweep === null || busy,
						onChange: toggle,
						label: t("sweepAutoLabel"),
					})
					: React.createElement("input", {
						type: "checkbox",
						checked: enabled,
						disabled: sweep === null || busy,
						"aria-label": t("sweepAutoLabel"),
						onChange: (event) => { toggle(event.target.checked); },
					});
				const runLabel = busy ? t("sweepRunning") : t("sweepRunLabel");
				const runNow = () => { call("?run=1", true); };

				const runIcon = busy ? React.createElement("span", { className: "dshdr-spin" }, Glyph(14)) : null;
				const runButton = OfficialButton !== null
					? React.createElement(OfficialButton, {
						variant: "ghost",
						disabled: busy,
						onClick: runNow,
						"aria-label": t("sweepAria"),
					}, runIcon, runLabel)
					: React.createElement("button", {
						type: "button",
						className: "dshdr-btn",
						"data-variant": "ghost",
						"data-busy": busy ? "1" : "0",
						disabled: busy,
						onClick: runNow,
						"aria-label": t("sweepAria"),
					}, runIcon, runLabel);

				const shown = busy ? { tone: "", text: t("sweepRunningLine") } : result;
				const resultLine = shown === null ? null : React.createElement("span", {
					className: "dshdr-set-result",
					"data-tone": shown.tone === "" ? undefined : shown.tone,
					"aria-live": "polite",
				}, React.createElement("span", { className: busy ? "dshdr-spin" : undefined }, Glyph(14)),
					React.createElement("span", null, shown.text));

				return React.createElement("div", { className: "dshdr-set-row" },
					React.createElement("span", { className: "dshdr-set-text" },
						React.createElement("span", { className: "dshdr-set-label" }, t("sweepLabel")),
						resultLine,
						React.createElement("span", { className: "dshdr-set-hint" }, hint),
						React.createElement("span", { className: "dshdr-set-hint" }, detail)),
					React.createElement("span", { className: "dshdr-set-actions" }, runButton, control));
			}

			function SettingsSection() {
				return React.createElement("div", { className: "dshdr-set-page" },
					React.createElement("h2", { className: "dshdr-set-title" }, t("setTitle")),
					React.createElement("p", { className: "dshdr-set-desc" }, t("setDesc")),

					React.createElement(ResumeRow),
					React.createElement("h3", { className: "dshdr-set-subtitle" }, t("extrasSubtitle")),
					React.createElement(SweepRow),
					React.createElement(HideContactRow));
			}

			ctx.effect(() => slots.inject(SIDEBAR_FOOTER_SLOT, () => slots.register({
				name: SIDEBAR_FOOTER_SLOT,
				id: ID,
				order: 100,
				label: t("navLabel"),
			}, SidebarRestartAction)));

			if (hideContactOn) startHider();
			ctx.effect(() => () => stopHider());

			ctx.effect(() => slots.inject(SETTINGS_SECTION_SLOT, () => slots.register({
				name: SETTINGS_SECTION_SLOT,
				id: ID,
				order: 90,
				label: () => t("pluginName"),
			}, SettingsSection)));
		}

		module.exports = { name: ID, inject: ["slots", "locale"], apply };
		return module.exports;
	}
});
