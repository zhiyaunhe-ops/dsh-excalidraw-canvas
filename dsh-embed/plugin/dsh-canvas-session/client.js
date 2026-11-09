window.__ModuleLoader__.load({
	id: "dsh-canvas-session",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		/**
		 * One canvas ⇄ one dsh session.
		 *
		 * The canvas page embeds this app as `<canvas-host>/dsh/?canvas=<stem>`
		 * (see embed.js). On boot we look up `dsh-canvas-session:<stem>` in
		 * localStorage:
		 *   - hit and the session still exists → open it;
		 *   - miss (or the session was deleted) → create a session inside the
		 *     "画布库" workspace (the canvas store), remember its id, open it.
		 *
		 * Everything here rides public client services only (`sessions`,
		 * `workspaces`, `uiWorkspace`), so no host-side wiring is needed.
		 */
		const INJECT = ["sessions", "workspaces", "uiWorkspace"];
		const CANVAS_DIR = "/var/www/canvas-library/drawings";
		const STORE_PREFIX = "dsh-canvas-session:";
		const TITLE_PREFIX = "画布 · ";
		const POLL_MS = 300;
		const READY_TIMEOUT_MS = 60000;

		function canvasKey() {
			const raw = new URLSearchParams(window.location.search).get("canvas");
			if (raw === null) return undefined;
			const stem = raw.trim();
			return stem === "" ? undefined : stem;
		}

		function normalizePath(value) {
			if (typeof value !== "string" || value === "") return undefined;
			const trimmed = value.replace(/\/+$/u, "");
			return trimmed === "" ? "/" : trimmed;
		}

		function hasPhase(snapshot, phase) {
			return snapshot !== undefined && snapshot !== null && snapshot.phase === phase;
		}

		/**
		 * Resolve the canvas-store workspace row, if the user kept that name.
		 * @param snapshot - workspace list snapshot.
		 * @returns the row whose canonical path is the canvas store.
		 */
		function canvasWorkspace(snapshot) {
			const items = Array.isArray(snapshot?.items) ? snapshot.items : [];
			return items.find((item) => normalizePath(item?.path) === CANVAS_DIR);
		}

		function apply(ctx) {
			const stem = canvasKey();
			if (stem === undefined) return;
			const storeKey = STORE_PREFIX + stem;
			const title = TITLE_PREFIX + stem;
			let settled = false;
			let timer;
			let inFlight = false;
			let attempts = 0;

			const finish = (reason) => {
				settled = true;
				if (timer !== undefined) window.clearInterval(timer);
				if (reason !== undefined) console.warn("[canvas-session]", reason);
			};

			const bind = async () => {
				const sessions = ctx.get("sessions");
				const workspaces = ctx.get("workspaces");
				const uiWorkspace = ctx.get("uiWorkspace");
				if (sessions === undefined || workspaces === undefined || uiWorkspace === undefined) return;
				const list = sessions.list.getSnapshot();
				const ws = workspaces.list.getSnapshot();
				if (!hasPhase(list, "ready") || !hasPhase(ws, "ready")) return;

				const remembered = window.localStorage.getItem(storeKey);
				const byId = list.byId ?? {};
				if (remembered !== null && byId[remembered] !== undefined) {
					uiWorkspace.openSession(remembered);
					finish();
					return;
				}
				if (remembered !== null) window.localStorage.removeItem(storeKey);

				// Second chance: another browser/device already made the session for this
				// canvas, recognizable by the durable title we always write below.
				for (const id of Object.keys(byId)) {
					const row = byId[id];
					if (row !== undefined && row !== null && row.title === title) {
						window.localStorage.setItem(storeKey, id);
						uiWorkspace.openSession(id);
						finish();
						return;
					}
				}

				const workspace = canvasWorkspace(ws);
				const request = workspace === undefined ? { cwd: CANVAS_DIR } : { workspaceId: workspace.workspaceId };
				// ClientSessions.create resolves with the id and throws a
				// SessionCreateError on refusal (it is not a RemoteResult).
				const sessionId = await sessions.create(request);
				window.localStorage.setItem(storeKey, sessionId);
				try {
					await sessions.using(sessionId, { source: "canvas-session" }, (reference) => reference.binding.session.rename(title));
				} catch (error) {
					// A rename refusal must not block the binding.
					console.warn("[canvas-session] rename skipped:", error);
				}
				uiWorkspace.openSession(sessionId);
				finish();
			};

			const tick = () => {
				if (settled || inFlight) return;
				inFlight = true;
				bind()
					.catch((error) => {
						// A create refusal is not transient; stop after a few tries so a
						// broken host cannot spray a session per poll tick.
						attempts += 1;
						console.warn("[canvas-session] bind failed:", error);
						if (attempts >= 3) finish("giving up after repeated bind failures");
					})
					.finally(() => {
						inFlight = false;
					});
			};

			timer = window.setInterval(tick, POLL_MS);
			window.setTimeout(() => {
				if (!settled) finish("timeout waiting for ready state; left the panel as-is");
			}, READY_TIMEOUT_MS);
			tick();
		}

		exports.inject = INJECT;
		exports.apply = apply;
		return module.exports;
	}
});
