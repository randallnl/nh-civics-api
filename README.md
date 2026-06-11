# NH Civics API

Cloudflare Worker project for `nhdb-api`.

## Local development

Install dependencies:

```sh
npm install
```

Start the Worker locally:

```sh
npm run dev
```

The local API should be available at:

```text
http://localhost:8787/health
```

Run a deploy dry run:

```sh
npm run dry-run
```

## Required Cloudflare bindings

Update `wrangler.jsonc` before deploying. The D1 database name and R2 bucket name are set, but the D1 `database_id` still needs the real Cloudflare UUID.

- `DB`: D1 database binding used by the API queries.
- `LEGISLATOR_PHOTOS`: R2 bucket binding used by `/admin/sync-legislator-photos`.

Set these secrets in Cloudflare:

```sh
npx wrangler secret put CIVIC_API_KEY
npx wrangler secret put ADMIN_SECRET
```

## Connect to the existing Cloudflare Worker

1. Commit and push this repository to GitHub.
2. In Cloudflare, open **Workers & Pages**.
3. Select the existing Worker named **nhdb-api**.
4. Open **Settings** then **Builds**.
5. Select **Connect** and choose this GitHub repository.
6. Use `/` as the root directory.
7. Use `npm install` as the build command if Cloudflare asks for one.
8. Use `npm run deploy` as the deploy command.

The Worker name in `wrangler.jsonc` must stay `nhdb-api` so it matches the existing Cloudflare Worker.
