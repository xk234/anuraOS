interface AppManifest {
	/**
	 * The name of the app.
	 */
	name: string;
	/**
	 * The package name of the app. This should be unique to the app and should be in reverse domain notation.
	 * For example, if the app is called "My App" and is made by "My Company", the package name should be
	 */
	package: string;
	/**
	 * The type of the app. This can be "auto" or "manual". If it is "manual", the app will be handled by the
	 * handler specified in the handler field. If it is "auto", the app will be handled by the index file
	 * specified in the index field. If the type is not "manual" or "auto", it will be handled by the anura
	 * library specified in the type field.
	 */
	type: "auto" | "manual" | string;
	/**
	 * The index file for the app. This is the file that will be loaded when the app is launched when the app
	 * is in auto mode.
	 */
	index?: string;
	/**
	 * The icon for the app. This should be a URL to an image file.
	 */
	icon: string;
	/**
	 * The handler for the app. This is the file that will be loaded when the app is launched when the app
	 * is in manual mode.
	 */
	handler?: string;
	/**
	 * Whether or not the app should be hidden from the app list. This is useful for apps that are
	 * only meant to be launched by other apps.
	 */
	hidden?: boolean;
	/**
	 * The background color of the element directly behind the app's window. This is optional and defaults
	 * to the system theme's background color.
	 */
	background?: string;
	/**
	 * This contains the properties for the default app window.
	 */
	wininfo: string | WindowInformation;
	/**
	 * Whether or not the app should use the IDB wrapper. This option allows the app to access indexedDB without
	 * worrying about the app purging anura's own databases.
	 */
	useIdbWrapper?: boolean;
}

class ExternalApp extends App {
	manifest: AppManifest;
	source: string;
	icon = "/assets/icons/generic.svg";

	constructor(manifest: AppManifest, source: string) {
		super();
		this.manifest = manifest;
		this.name = manifest.name;
		if (manifest.icon) {
			this.icon = source + "/" + manifest.icon;
		}
		this.source = source;
		this.package = manifest.package;
		this.hidden = manifest.hidden || false;
	}

	static serializeArgs(args: string[]): string {
		const encoder = new TextEncoder();
		const encodedValues = args.map((value) => {
			const bytes = encoder.encode(value);
			const binString = String.fromCodePoint(...bytes);
			return btoa(binString);
		});
		return encodeURIComponent(encodedValues.join(","));
	}

	static deserializeArgs(args: string): string[] {
		const decoder = new TextDecoder("utf-8");
		return decodeURIComponent(args)
			.split(",")
			.map((value) => {
				const binString = atob(value);
				return decoder.decode(
					Uint8Array.from(binString, (c) => c.charCodeAt(0)),
				);
			});
	}

	//@ts-expect-error manual apps exist
	async open(args: string[] = []): Promise<WMWindow | undefined> {
		if (this.manifest.type === "auto") {
			const win = anura.wm.create(this, this.manifest.wininfo);
			const iframe = document.createElement("iframe");
			const bg = this.manifest.background || "var(--theme-bg)";
			iframe.setAttribute("style", "top:0; left:0; bottom:0; right:0; width:100%; height:100%; border:none; margin:0; padding:0; background-color:" + bg + ";");
			iframe.id = "proc-" + win.pid;
			iframe.src = "about:blank?args=" + ExternalApp.serializeArgs(args);
			win.content.appendChild(iframe);

			const frameWindow = iframe.contentWindow!;
			const sourceRoot = new URL(this.source.endsWith("/") ? this.source : this.source + "/", location.href);
			const appUrl = new URL(this.manifest.index || "index.html", sourceRoot);
			appUrl.searchParams.set("args", ExternalApp.serializeArgs(args));
			const sameOrigin = appUrl.origin === location.origin;

			if (sameOrigin) {
				if (this.manifest.useIdbWrapper) {
					const idbWrapper = new Proxy(frameWindow.indexedDB, {
						get: (target, prop, receiver) => {
							switch (prop) {
								case "databases": return async () => (await target.databases()).filter((db: any) => db.name.startsWith(this.package + "-")).map((db: any) => ({ ...db, name: db.name.slice(this.package.length + 1) }));
								case "open": return (name: string, version?: number) => target.open(name.startsWith(this.package + "-") ? name : this.package + "-" + name, version);
								case "deleteDatabase": return (name: string) => target.deleteDatabase(name.startsWith(this.package + "-") ? name : this.package + "-" + name);
								default: return Reflect.get(target, prop, receiver);
							}
						},
					});
					Object.defineProperty(frameWindow, "indexedDB", { value: idbWrapper, writable: false });
				}
				Object.assign(frameWindow as any, {
					anura, AliceWM, ExternalApp, LocalFS, instance: this, instanceWindow: win,
					print: (message: string) => frameWindow.postMessage({ type: "stdout", message }),
					println: (message: string) => frameWindow.postMessage({ type: "stdout", message: message + "\n" }),
					printerr: (message: string) => frameWindow.postMessage({ type: "stderr", message }),
					printlnerr: (message: string) => frameWindow.postMessage({ type: "stderr", message: message + "\n" }),
					read: () => new Promise((resolve) => frameWindow.addEventListener("message", (event) => { if (event.data?.type === "stdin") resolve(event.data.message); }, { once: true })),
					readln: () => new Promise((resolve) => { let buffer = ""; const listener = (event: MessageEvent<any>) => { if (event.data?.type === "stdin") { buffer += event.data.message; if (buffer.includes("\n")) { resolve(buffer); frameWindow.removeEventListener("message", listener); } } }; frameWindow.addEventListener("message", listener); }),
					env: { process: win },
					open: async (url: string | URL) => { const browser = await anura.import("anura.libbrowser"); browser.openTab(url); },
				});
			}

			win.stdin = new WritableStream({ write: (message) => frameWindow.postMessage({ type: "stdin", message }) });
			win.stderr = new ReadableStream({ start: (controller) => {
				frameWindow.addEventListener("error", (event: ErrorEvent) => controller.enqueue(event.error || event.message));
				frameWindow.addEventListener("message", (event) => { if (event.data?.type === "stderr") controller.enqueue(event.data.message); });
			} });
			win.stdout = new ReadableStream({ start: (controller) => frameWindow.addEventListener("message", (event) => { if (event.data?.type === "stdout") controller.enqueue(event.data.message); }) });

			if (sameOrigin) {
				// Assigning src before injecting globals navigated away from about:blank and
				// silently discarded every injected API. Fetch + document.write keeps the
				// same Window object, so app scripts see Anura's APIs from their first line.
				try {
					const response = await fetch(appUrl);
					if (!response.ok) throw new Error("App page returned HTTP " + response.status + " (" + appUrl.href + ")");
					let html = await response.text();
					const baseHref = appUrl.href.replace(/&/g, "&amp;").replace(/\"/g, "&quot;");
					const baseTag = "<base href=\"" + baseHref + "\">";
					if (/<head(?:\\s[^>]*)?>/i.test(html)) html = html.replace(/(<head(?:\\s[^>]*)?>)/i, "$1" + baseTag);
					else html = html.replace(/<html(?:\\s[^>]*)?>/i, "$&<head>" + baseTag + "</head>");
					frameWindow.document.open();
					frameWindow.document.write(html);
					frameWindow.document.close();
					const matter = frameWindow.document.createElement("link");
					matter.rel = "stylesheet";
					matter.href = "/assets/matter.css";
					frameWindow.document.head?.appendChild(matter);
				} catch (error) {
					console.error("Failed to load Anura app " + this.package, error);
					frameWindow.document.open();
					frameWindow.document.write("<!doctype html><html><body style='background:#171717;color:#eee;font:14px sans-serif;padding:20px'></body></html>");
					frameWindow.document.close();
					const message = frameWindow.document.createElement("pre");
					message.textContent = "Unable to open " + this.name + ": " + String(error);
					frameWindow.document.body.appendChild(message);
				}
			} else {
				// Cross-origin apps cannot receive parent-window APIs; load them normally.
				iframe.src = appUrl.href;
			}
			return win;
		} else if (this.manifest.type === "manual") {
			const req = await fetch(this.source + "/" + this.manifest.handler);
			if (!req.ok) throw new Error("App handler returned HTTP " + req.status);
			const data = await req.text();
			top!.window.eval(data);
			// @ts-ignore
			loadingScript(this.source, this);
			taskbar.updateTaskbar();
			alttab.update();
			return;
		}
	}
}
