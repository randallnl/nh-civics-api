# NH Civics API

Cloudflare Worker project for `nh-civics-api`, served from `api.nhciviccommons.com`.

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

## Endpoints

- `GET /communities`: lists New Hampshire House and Senate districts with representatives, towns represented, and related article previews.
  - `body=house|senate|all`
  - `q=<search>`
  - `limit=<1-50>`
  - `offset=<number>`
  - `articleLimit=<0-10>`
- `GET /communities/counties/{county}`: returns a House county summary with district paths, towns represented, representative count, and related article placeholders.
- `GET /communities/towns/{town}`: returns a town or city summary with House and Senate districts, representatives, matching candidates, and related article previews.
  - `articleLimit=<0-25>`
  - `voteLimit=<0-100>` defaults to `0`
  - `candidateYear=<year>` defaults to `2026`
- `GET /communities/house/{county}/{district}`: returns one House district with representatives, senators, towns represented, and related articles.
- `GET /communities/senate/{district}`: returns one Senate district with representatives, towns represented, and related articles.
- `GET /candidates`: lists candidates with filing, office, party, fundraising, contact, photo, and slug fields.
  - `q=<search>`
  - `officeType=<type>`
  - `office=<office>`
  - `county=<county>`
  - `district=<district>`
  - `party=<party>`
  - `electionYear=<year>`
  - `limit=<1-100>`
  - `offset=<number>`
- `GET /candidates/{slug-or-filer-entity-number}`: returns one candidate.
- `POST /reps/lookup`: returns civic district matches, representatives, grouped representatives, and matching candidates for the address.
  - `candidateYear=<year>` defaults to `2026`

## Required Cloudflare bindings

The required Cloudflare resource bindings are configured in `wrangler.jsonc`.

The Worker route is configured as a custom domain for `api.nhciviccommons.com`.

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
3. Select the existing Worker named **nh-civics-api**.
4. Open **Settings** then **Builds**.
5. Select **Connect** and choose this GitHub repository.
6. Use `/` as the root directory.
7. Use `npm install` as the build command if Cloudflare asks for one.
8. Use `npm run deploy` as the deploy command.

The Worker name in `wrangler.jsonc` must stay `nh-civics-api` so it matches the existing Cloudflare Worker.
