# Cloudflare Pages deployment

This repository builds AnuraOS in GitHub Actions and publishes the generated `static/` directory to the existing Cloudflare Pages project `anurax`.

## Why the build runs in GitHub Actions

The AnuraOS build needs system packages and toolchains that are not guaranteed to exist in Cloudflare Pages' managed build image (including `jq`, Rust/WASM tools, Java, Docker, and 32-bit build dependencies). Building in a pinned Ubuntu GitHub Actions runner keeps those requirements in one place and avoids maintaining a second, incomplete build environment.

Cloudflare's Git-connected build is therefore disabled for this project. Do not restore the Cloudflare build command to `make static`; it will reintroduce the missing-tool failures.

## Workflow

The `.github/workflows/build-static.yml` workflow:

1. Checks out the repository and its submodules.
2. Installs the native, Node, Rust, and WASM build dependencies.
3. Builds the Alpine x86 root filesystem and copies its generated chunk configuration into `public/config.json`.
4. Runs `make static`.
5. Verifies that the 1 GiB source rootfs image is not included and that no rootfs chunk exceeds Cloudflare Pages' 25 MiB per-file limit.
6. Uploads the generated `static/` directory as a short-lived Actions artifact.
7. Deploys `static/` to the `anurax` Pages project on pushes to `main`, when the Cloudflare credentials are configured.

The workflow can also be started manually from the GitHub Actions tab using **Build and deploy AnuraOS**.

## Required GitHub Actions secrets

Add these under **Repository Settings → Secrets and variables → Actions**:

- `CLOUDFLARE_API_TOKEN`: an API token authorized to deploy to Cloudflare Pages.
- `CLOUDFLARE_ACCOUNT_ID`: the Cloudflare account ID containing the `anurax` Pages project.

If either secret is missing, the workflow still builds and uploads the site artifact, but skips the Cloudflare deployment and emits a warning.

## Cloudflare Pages project settings

The Pages project remains the public host for `anurax.pages.dev`, but automatic Git deployments are disabled. Its build command is blank because GitHub Actions supplies the already-built static output using Wrangler. Keep the production branch set to `main`.

No Worker, Pages Function, custom backend, VPS, or paid build service is required by this deployment flow.
