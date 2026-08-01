# Deploying Traggo with Grafana (embedded dashboards)

This guide describes how to run the embedded-view fork of Traggo together with
Grafana, using Podman pods (or Docker as an alternative). The whole setup is a
single Podman pod with two containers and one shared volume:

```
┌────────────────────── pod traggo-pod ──────────────────────┐
│  traggo  (UI+API, sqlite)        grafana  (dashboards)     │
│  :3030 ──► host 8080             :3000 ──► host 3000       │
│                                                             │
│  shared volume "traggo-data" mounted at /data in both       │
│  traggo writes /data/traggo.db, grafana opens the same      │
│  file (needs write access, see "File permissions")          │
└─────────────────────────────────────────────────────────────┘
```

## 1. Build the server image

The embedded view is a frontend-only change, so the image has to be built from
this repository (the upstream image does not contain it):

```bash
# build the UI (on Node 17+ this needs the legacy OpenSSL provider for webpack 4)
(cd ui && NODE_OPTIONS=--openssl-legacy-provider CI=true yarn build)

# build the server binary (distroless base images ship glibc, so the default
# dynamic linking is fine; the Makefile's static build needs glibc-static)
CGO_ENABLED=1 go build -o build/traggo-server .
```

Then create an image with a minimal distroless Containerfile:

```dockerfile
FROM gcr.io/distroless/base-debian12
WORKDIR /opt/traggo
COPY traggo-server /opt/traggo/traggo
EXPOSE 3030
ENTRYPOINT ["./traggo"]
```

```bash
podman build -t localhost/traggo/server:embed .
```

## 2. Create the pod and the volume

```bash
podman pod create --name traggo-pod -p 8080:3030 -p 3000:3000
podman volume create traggo-data
```

Ports are published at pod level; the containers reach each other over
`localhost` inside the pod.

## 3. Run Traggo

```bash
podman run -d --pod traggo-pod --name traggo \
  -e TRAGGO_DATABASE_DIALECT=sqlite3 \
  -e 'TRAGGO_DATABASE_CONNECTION=/data/traggo.db?_busy_timeout=20000' \
  -v traggo-data:/data:z \
  localhost/traggo/server:embed
```

The `_busy_timeout=20000` connection parameter prevents SQLite `database is
locked` errors when Grafana reads the same file.

## 4. Run Grafana

```bash
podman run -d --pod traggo-pod --name grafana \
  -e GF_INSTALL_PLUGINS=frser-sqlite-datasource \
  -v traggo-data:/data:z \
  -v grafana-data:/var/lib/grafana:z \
  -v /path/to/grafana.ini:/etc/grafana/grafana.ini:z \
  -v /path/to/provisioning:/etc/grafana/provisioning:z \
  docker.io/grafana/grafana:11.5.2
```

`GF_INSTALL_PLUGINS` installs the SQLite datasource plugin on first start.
`traggo-data:/data` gives Grafana access to the Traggo database file, which is
used as the datasource (see below). `grafana-data` persists Grafana's own data,
`grafana.ini` and `provisioning` hold the configuration from this folder.

### File permissions (important)

The Grafana 11.x image runs as the non-root user `grafana` (uid 472), and the
frser plugin opens the SQLite file read-write. If it cannot open it for writing
it fails SILENTLY: the datasource health check reports OK and queries return
empty frames — the dashboard renders but shows no data.

The volume and database file must therefore be writable by uid 472. In rootless
podman the container group id 0 maps to your host user's group, so group write
permission is enough:

```bash
VOLUME_DIR="$HOME/.local/share/containers/storage/volumes/traggo-data/_data"
chmod 2775 "$VOLUME_DIR"          # group-writable, inherits group for new files
chmod 664  "$VOLUME_DIR/traggo.db"
```

Run the traggo container first so `traggo.db` exists (traggo creates it on
first start), then apply the chmods before starting grafana. With rootful
podman or Docker the same commands work unchanged.

### SELinux (Fedora/RHEL)

Bind mounts and volumes need `:z` so the containers can access them. Do not use
`:Z` for volumes shared between the two containers — `:Z` relabels the volume
private to one container and would break the sharing.

## 5. Configure Grafana

`grafana.ini`:

```ini
[security]
allow_embedding = true

[auth.anonymous]
enabled = true
org_name = Main Org.
org_role = Editor
```

`allow_embedding` is required for the dashboard to render inside the iframe on
the Traggo page. The anonymous user needs Editor to read the dashboards; keep
them in a folder that is visible to anonymous (see below).

Datasource provisioning (`provisioning/datasources/datasources.yml`):

```yaml
apiVersion: 1

datasources:
  - name: Traggo SQLite
    type: frser-sqlite-datasource
    access: proxy
    uid: traggo-sqlite
    orgId: 1
    isDefault: true
    editable: true
    jsonData:
      path: /data/traggo.db
```

Dashboard provisioning (`provisioning/dashboards/dashboards.yml`):

```yaml
apiVersion: 1

providers:
  - name: traggo
    orgId: 1
    folder: Traggo
    type: file
    disableDeletion: true
    updateIntervalSeconds: 30
    allowUiUpdates: true
    options:
      path: /etc/grafana/provisioning/dashboards/traggo
```

Create the `Traggo` folder in the Grafana UI and import your dashboard
(or export it from an existing instance and place the JSON in that path).
Dashboards reference the datasource by uid `traggo-sqlite` and the folder named
`Traggo` — adjust both if your instance differs.

### Provisioning vs. UI edits

File provisioning in Grafana 11.x always overwrites the dashboard (the
`overwrite: false` option is ignored). To keep layout edits made in the UI,
import the dashboard once and then move the JSON out of the provisioning folder;
`disableDeletion: true` keeps the dashboard alive when the file disappears.

## 6. Lifecycle

```bash
podman pod start traggo-pod    # or: podman start traggo grafana
podman pod stop traggo-pod
podman ps --pod
podman logs -f traggo          # or: grafana
```

Auto-start at boot with systemd (user units):

```bash
mkdir -p ~/.config/systemd/user
podman generate systemd --new --name traggo-pod -f ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now traggo-pod-pod.service
loginctl enable-linger $USER   # keep user services running without login
```

## Docker alternative

The same setup with Docker: create a shared network, mount the volume, and give
Grafana the same file path. Equivalent `docker-compose.yml` (do not mount
`traggo-data` read-only — the plugin needs to open the file for writing; apply
the same chmod/chown from the permissions section above, rootful Docker
included):

```yaml
services:
  traggo:
    image: localhost/traggo/server:embed
    ports: ["8080:3030"]
    environment:
      TRAGGO_DATABASE_DIALECT: sqlite3
      TRAGGO_DATABASE_CONNECTION: /data/traggo.db?_busy_timeout=20000
    volumes: ["traggo-data:/data"]
  grafana:
    image: docker.io/grafana/grafana:11.5.2
    ports: ["3000:3000"]
    environment:
      GF_INSTALL_PLUGINS: frser-sqlite-datasource
    volumes:
      - traggo-data:/data
      - grafana-data:/var/lib/grafana
      - ./grafana.ini:/etc/grafana/grafana.ini
      - ./provisioning:/etc/grafana/provisioning
volumes:
  traggo-data:
  grafana-data:
```

## Embedding other tools

The embedded view is tool-agnostic: Traggo renders the URL you configure per
dashboard as-is — no transformation is applied. Paste the plain dashboard URL
(e.g. `http://localhost:3000/d/traggo-study-overview/traggo-overview?orgId=1&from=now-30d&to=now&timezone=browser&var-tag=$__all&refresh=1m`).
Only if you want to hide the tool's own chrome inside the iframe, append its
kiosk parameter yourself (Grafana `?kiosk`, Superset `?standalone=true`,
Metabase ...).

## SQL gotchas for custom panels

- frser-sqlite-datasource types each column from the FIRST row's value. Pad
  with `0.0` (`ELSE 0.0 END`, `COALESCE(x, 0.0)`) instead of `0`, otherwise
  fractional hours are truncated to integers.
- Exclude running entries with `ts.end_utc IS NOT NULL`.

## Troubleshooting

- **Grafana exits at startup with `attempt to write a readonly database`** —
  `/var/lib/grafana` is not writable by uid 472, typically after restoring a
  backup. Fix: `podman unshare chown -R 472:472 <grafana-data-dir>` (rootful
  podman/Docker: `chown -R 472:472 <dir>`), then restart grafana.
- **Dashboard renders but shows "No data", datasource health check is OK** —
  the SQLite file cannot be opened for writing (see "File permissions"
  above). The frser plugin swallows this error and returns empty results.
- **`database is locked` errors on the Traggo side** — the
  `_busy_timeout=20000` parameter is missing from
  `TRAGGO_DATABASE_CONNECTION`.
