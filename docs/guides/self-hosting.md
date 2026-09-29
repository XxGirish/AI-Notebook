# Self-hosting and using a tablet

AI Notebook is a static web app plus an optional AI gateway. Notebooks live in the browser that opens the app; the server stores nothing about them.

> **Status:** the development setup below is what the project uses day to day. The HTTPS recipes for a tablet are standard configurations for the tools named, written down here as a starting point; they have **not** yet been run end to end on a physical tablet in this project.

## Why a tablet needs HTTPS

Several features only work in a *secure context* — `https://`, or `http://localhost` on the same device:

- **Web Locks**, which keep one tab writable at a time. Without them the app opens read-only (by design; see `docs/decisions/0002-single-writer-web-lock.md`).
- **The service worker**, which makes the app open offline.
- **Web Crypto** hashing used for images, archives and source files.

On a tablet, `localhost` means the tablet itself, and `http://192.168.x.x:5173` from your laptop is **not** secure. So the development server's LAN address is fine for looking at the layout but will open read-only. Real use on a tablet needs HTTPS.

## 1. Development on one computer

```bash
npm install
npm run dev            # the notebook, http://localhost:5173
npm run dev:gateway    # the AI gateway on 127.0.0.1:8787, mock provider by default
```

Vite proxies `/api` to the gateway, so the browser only ever talks to one origin.

## 2. A production build

```bash
npm run build          # writes apps/web/dist
```

`apps/web/dist` is plain static files: serve it from any web server. The app expects the gateway at `/api` on the **same origin**, so the web server must forward `/api/*` to the gateway (`npm run start --workspace @ai-notebook/gateway`, listening on `127.0.0.1:8787` by default). Serve `index.html` for unknown paths.

## 3. HTTPS for a tablet on your network

Pick one.

### Option A — Caddy with its own local certificate authority

[Caddy](https://caddyserver.com/) can serve the build, forward `/api`, and issue a certificate from a private authority it creates. Example `Caddyfile` (replace the IP with your computer's LAN address and the path with yours):

```caddyfile
https://192.168.1.20:8443 {
	tls internal
	handle /api/* {
		reverse_proxy 127.0.0.1:8787
	}
	handle {
		root * /path/to/AI-Notebook/apps/web/dist
		try_files {path} /index.html
		file_server
	}
}
```

The tablet must trust Caddy's root certificate once: export it from Caddy's data directory (`pki/authorities/local/root.crt`) and install it on the tablet. On iPad that is a configuration profile followed by *Settings → General → About → Certificate Trust Settings*; on Android it is *Settings → Security → Encryption & credentials → Install a certificate → CA certificate*. Remove it when you stop using it: a trusted root can vouch for any site.

### Option B — Tailscale

If both devices are on a [Tailscale](https://tailscale.com/) network, `tailscale serve` can publish a local port over HTTPS on your machine's tailnet name with a publicly trusted certificate, so nothing needs installing on the tablet. Serve something that already combines the build and `/api` (for example Caddy from option A on plain HTTP bound to `127.0.0.1`), because the app and the gateway must share one origin.

## 4. The gateway on a network

The gateway listens on `127.0.0.1` unless `GATEWAY_HOST` says otherwise. Keep it there and put the HTTPS server in front of it. If you do bind it elsewhere, it refuses to start without `GATEWAY_ACCESS_TOKEN` (at least 32 random characters), and the web build needs the same value in `VITE_GATEWAY_ACCESS_TOKEN`. That token only keeps other people on the network from using your AI budget. It is visible to anyone who can open the app, so it is not a password, and it is never your DeepSeek key.

**Do not expose the gateway to the internet.** It is built for one person: an unauthenticated public gateway would let anyone spend your DeepSeek balance, and the project does not provide a shared inference service or key.

## 5. Updating

Pull the new code, then `npm ci`, `npm run build`, and restart the gateway. Open tabs show **Update and reload** once their work is saved; nothing reloads underneath unsaved changes. Each browser keeps its own notebooks, so export an archive before large upgrades (see [backup and restore](backup-and-restore.md)).
