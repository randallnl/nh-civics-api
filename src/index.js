const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-admin-secret",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    if (url.pathname === "/") {
      return json({
        name: "NH Deserves Better API",
        status: "ok",
        endpoints: [
          "/tools",
          "/communities",
          "/communities/house/{county}/{district}",
          "/communities/senate/{district}",
          "/reps/search?town=Manchester",
          "/reps/lookup",
          "/reps/{employeeno}/votes",
          "/bills",
          "/events",
          "/admin/sync-legislator-photos",
        ],
      });
    }

    if (url.pathname === "/articles") {
      return handleArticles(request, env);
    }
    
    if (url.pathname.startsWith("/articles/")) {
      return handleArticleDetail(request, env);
    }

    if (url.pathname === "/tools") {
      return json([
        {
          title: "My State Rep",
          description:
            "Find your representatives and understand how they are voting.",
          url: "/tools/my-state-rep",
          status: "active",
        },
        {
          title: "Bill Tracker",
          description: "Track key legislation, testimony, and vote history.",
          url: "/tools/bill-tracker",
          status: "planned",
        },
        {
          title: "Accountability Dashboard",
          description:
            "Explore voting records and public accountability data.",
          url: "/tools/accountability",
          status: "planned",
        },
      ]);
    }

    if (url.pathname === "/communities") {
      return handleCommunities(request, env);
    }

    if (url.pathname.startsWith("/communities/")) {
      return handleCommunityDetail(request, env);
    }

    if (url.pathname.startsWith("/reps/") && url.pathname.endsWith("/votes")) {
      return handleRepVotes(request, env);
    }




    if (url.pathname === "/reps/search") {
      return handleTownSearch(request, env);
    }

    if (url.pathname === "/reps/lookup-address") {
      const address = url.searchParams.get("address");

      if (!address) {
        return json(
          {
            error: "Address query parameter is required.",
          },
          400
        );
      }

      const fakeRequest = new Request(request.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ address }),
      });

      return handleAddressLookup(fakeRequest, env);
    }

    if (url.pathname === "/reps/lookup") {
      return handleAddressLookup(request, env);
    }
    
    if (url.pathname.startsWith("/reps/") && !url.pathname.endsWith("/votes")) {
      return handleRepProfile(request, env);
    }

    if (url.pathname === "/bills") {
      return handleBills(request, env);
    }
    
    if (url.pathname.startsWith("/bills/") && url.pathname.endsWith("/testimony")) {
      return handleBillTestimony(request, env);
    }
    
    if (url.pathname.startsWith("/bills/")) {
      return handleBillDetail(request, env);
    }

    if (url.pathname === "/events") {
      return json({
        message: "Events endpoint coming soon.",
      });
    }

    if (url.pathname === "/admin/sync-legislator-photos") {
      return handlePhotoSync(request, env);
    }

    return json({ error: "Not found" }, 404);
  },
};


async function handleRepProfile(request, env) {
  const url = new URL(request.url);
  const parts = url.pathname.split("/");
  const identifier = parts[2];
  const voteLimit = Number(url.searchParams.get("voteLimit") || 100);

  if (!identifier) {
    return json({ error: "Representative identifier is required." }, 400);
  }

  const isNumeric = /^\d+$/.test(identifier);

  const legislator = await env.DB.prepare(`
    SELECT
      l.personid AS id,
      l.personid,
      l.employeeno,
      CASE l.legislativebody
        WHEN 'S' THEN 'Senate'
        WHEN 'H' THEN 'House'
        ELSE l.legislativebody
      END AS chamber,
      l.firstname || ' ' || l.lastname AS name,
      l.firstname,
      l.lastname,
      l.middlename,
      l.party,
      COALESCE(dm.district_label, l.district) AS district,
      l.district AS raw_district,
      l.countycode,
      COALESCE(dm.communities_represented, l.city, '') AS location_text,
      l.address,
      l.address2,
      l.city,
      l.zipcode,
      l.emailaddress AS email,
      '' AS phone,
      COALESCE(p.photo_url, '') AS photo,
      l.database_name
    FROM d1_legislators l
    LEFT JOIN d1_district_mapping dm
      ON (
        (
          l.legislativebody = 'H'
          AND dm.body = 'H'
          AND CAST(l.countycode AS INTEGER) = dm.county
          AND CAST(l.district AS INTEGER) = dm.district
        )
        OR
        (
          l.legislativebody = 'S'
          AND dm.body = 'S'
          AND CAST(l.district AS INTEGER) = dm.district
        )
      )
    LEFT JOIN d1_legislator_photos p
      ON p.employeeno = l.employeeno
    WHERE l.active = 1
      AND ${
        isNumeric
          ? "l.personid = ?"
          : "LOWER(l.firstname || '-' || l.lastname) = LOWER(?)"
      }
    LIMIT 1
  `)
    .bind(identifier)
    .first();

  if (!legislator) {
    return json({ error: "Representative not found." }, 404);
  }

  const voteHistory = await getVoteHistoryForRep(
    env,
    legislator.employeeno,
    voteLimit
  );

  const relatedArticles = await getArticlesForLegislator(
    env,
    legislator.personid,
    legislator.employeeno,
    10
  );

  return json({
    representative: {
      ...legislator,
      sourceUrls: {
        generalCourt: buildGeneralCourtUrl(legislator),
        photo: legislator.photo || null,
      },
    },
    voteHistory,
    relatedArticles,
  });
}

function buildGeneralCourtUrl(rep) {
  if (!rep) return null;

  if (rep.chamber === "Senate") {
    return `https://www.gencourt.state.nh.us/senate/members/webpages/district${rep.raw_district}.aspx`;
  }

  return `https://www.gencourt.state.nh.us/house/members/member.aspx?pid=${rep.personid}`;
}

async function handleCommunities(request, env) {
  const url = new URL(request.url);
  const body = String(url.searchParams.get("body") || "all").toLowerCase();
  const q = String(url.searchParams.get("q") || "").trim();
  const limit = boundedNumber(url.searchParams.get("limit"), 50, 1, 50);
  const offset = boundedNumber(url.searchParams.get("offset"), 0, 0, 10000);
  const articleLimit = boundedNumber(
    url.searchParams.get("articleLimit"),
    3,
    0,
    10
  );

  const where = [`d.type IN ('house_district', 'senate_district')`];
  const binds = [];

  if (body === "house") {
    where.push(`d.type = 'house_district'`);
  } else if (body === "senate") {
    where.push(`d.type = 'senate_district'`);
  } else if (body !== "all") {
    return json({ error: "body must be house, senate, or all." }, 400);
  }

  if (q) {
    const search = `%${q}%`;
    where.push(`
      (
        d.name LIKE ?
        OR d.slug LIKE ?
        OR COALESCE(d.county, '') LIKE ?
        OR COALESCE(d.towns_represented, '') LIKE ?
        OR COALESCE(dm.communities_represented, '') LIKE ?
      )
    `);
    binds.push(search, search, search, search, search);
  }

  const districts = await env.DB.prepare(`
    SELECT
      d.id,
      d.name,
      d.slug,
      d.type,
      CASE
        WHEN d.type = 'senate_district' THEN 'Senate'
        WHEN d.type = 'house_district' THEN 'House'
        ELSE d.type
      END AS chamber,
      CASE
        WHEN d.type = 'senate_district' THEN 'S'
        WHEN d.type = 'house_district' THEN 'H'
        ELSE NULL
      END AS body,
      cc.source_county_id AS county_number,
      d.county,
      COALESCE(
        d.district,
        CAST(REPLACE(d.slug, 'nh-senate-district-', '') AS INTEGER)
      ) AS district_number,
      COALESCE(dm.district_label, d.name) AS district_label,
      COALESCE(dm.communities_represented, d.towns_represented, '') AS communities_represented,
      d.towns_represented,
      d.floterial,
      d.seats
    FROM divisions d
    LEFT JOIN county_codes cc
      ON LOWER(cc.name) = LOWER(d.county)
    LEFT JOIN d1_district_mapping dm
      ON (
        d.type = 'house_district'
        AND dm.body = 'H'
        AND dm.county = cc.source_county_id
        AND dm.district = d.district
      )
      OR (
        d.type = 'senate_district'
        AND dm.body = 'S'
        AND dm.district = CAST(REPLACE(d.slug, 'nh-senate-district-', '') AS INTEGER)
      )
    WHERE ${where.join(" AND ")}
    ORDER BY
      CASE d.type
        WHEN 'senate_district' THEN 1
        WHEN 'house_district' THEN 2
        ELSE 3
      END,
      COALESCE(cc.source_county_id, 0),
      district_number,
      d.name
    LIMIT ?
    OFFSET ?
  `)
    .bind(...binds, limit, offset)
    .all();

  const communities = [];

  for (const district of districts.results || []) {
    communities.push(
      await buildCommunityResponse(env, district, articleLimit)
    );
  }

  return json({
    communities,
    meta: {
      body,
      q,
      limit,
      offset,
      count: communities.length,
      articleLimit,
    },
  });
}

async function handleCommunityDetail(request, env) {
  const url = new URL(request.url);
  const parts = url.pathname.split("/").filter(Boolean);
  const kind = String(parts[1] || "").toLowerCase();
  const articleLimit = boundedNumber(
    url.searchParams.get("articleLimit"),
    10,
    0,
    50
  );

  let district;

  if (kind === "senate") {
    const districtNumber = Number(parts[2]);

    if (!Number.isInteger(districtNumber) || districtNumber < 1) {
      return json(
        { error: "Use /communities/senate/{district}." },
        400
      );
    }

    district = await getCommunityDistrict(env, {
      body: "S",
      districtNumber,
    });
  } else if (kind === "house") {
    const county = decodeURIComponent(parts[2] || "");
    const districtNumber = Number(parts[3]);

    if (!county || !Number.isInteger(districtNumber) || districtNumber < 1) {
      return json(
        { error: "Use /communities/house/{county}/{district}." },
        400
      );
    }

    district = await getCommunityDistrict(env, {
      body: "H",
      county,
      districtNumber,
    });
  } else {
    return json(
      {
        error:
          "Unknown community type. Use /communities/house/{county}/{district} or /communities/senate/{district}.",
      },
      404
    );
  }

  if (!district) {
    return json({ error: "Community district not found." }, 404);
  }

  return json({
    community: await buildCommunityResponse(env, district, articleLimit),
    meta: {
      articleLimit,
    },
  });
}

async function getCommunityDistrict(env, { body, county, districtNumber }) {
  const where = [];
  const binds = [];

  if (body === "S") {
    where.push(`d.type = 'senate_district'`);
    where.push(
      `CAST(REPLACE(d.slug, 'nh-senate-district-', '') AS INTEGER) = ?`
    );
    binds.push(districtNumber);
  } else {
    const normalizedCounty = normalizeCommunityPathPart(county);
    const numericCounty = Number(normalizedCounty);
    where.push(`d.type = 'house_district'`);
    where.push(`d.district = ?`);
    where.push(`
      (
        LOWER(d.county) = ?
        OR LOWER(REPLACE(d.county, ' ', '-')) = ?
        OR cc.code = ?
        OR cc.source_county_id = ?
      )
    `);
    binds.push(
      districtNumber,
      normalizedCounty.replace(/-/g, " "),
      normalizedCounty,
      normalizedCounty.padStart(2, "0"),
      Number.isFinite(numericCounty) ? numericCounty : -1
    );
  }

  return env.DB.prepare(`
    SELECT
      d.id,
      d.name,
      d.slug,
      d.type,
      CASE
        WHEN d.type = 'senate_district' THEN 'Senate'
        WHEN d.type = 'house_district' THEN 'House'
        ELSE d.type
      END AS chamber,
      CASE
        WHEN d.type = 'senate_district' THEN 'S'
        WHEN d.type = 'house_district' THEN 'H'
        ELSE NULL
      END AS body,
      cc.source_county_id AS county_number,
      d.county,
      COALESCE(
        d.district,
        CAST(REPLACE(d.slug, 'nh-senate-district-', '') AS INTEGER)
      ) AS district_number,
      COALESCE(dm.district_label, d.name) AS district_label,
      COALESCE(dm.communities_represented, d.towns_represented, '') AS communities_represented,
      d.towns_represented,
      d.floterial,
      d.seats
    FROM divisions d
    LEFT JOIN county_codes cc
      ON LOWER(cc.name) = LOWER(d.county)
    LEFT JOIN d1_district_mapping dm
      ON (
        d.type = 'house_district'
        AND dm.body = 'H'
        AND dm.county = cc.source_county_id
        AND dm.district = d.district
      )
      OR (
        d.type = 'senate_district'
        AND dm.body = 'S'
        AND dm.district = CAST(REPLACE(d.slug, 'nh-senate-district-', '') AS INTEGER)
      )
    WHERE ${where.join(" AND ")}
    LIMIT 1
  `)
    .bind(...binds)
    .first();
}

async function buildCommunityResponse(env, district, articleLimit) {
  const representatives = await getRepresentativesForDistrict(env, district);
  const relatedArticles = await getArticlesForCommunityPreview(
    env,
    district,
    representatives,
    articleLimit
  );

  return {
    id: district.id,
    slug: district.slug,
    name: district.name,
    chamber: district.chamber,
    body: district.body,
    county: district.county || null,
    district: district.district_number,
    label: district.district_label,
    townsRepresented: splitCommunityList(
      district.communities_represented || district.towns_represented
    ),
    floterial: parseBooleanText(district.floterial),
    seats: district.seats || representatives.length || null,
    representativeSummary: {
      count: representatives.length,
      names: representatives.map((rep) => rep.name),
      parties: summarizeParties(representatives),
    },
    representatives,
    relatedArticles,
  };
}

async function getRepresentativesForDistrict(env, district) {
  if (!district.body || !district.district_number) return [];

  let sql = `
    SELECT
      l.personid AS id,
      l.personid,
      l.employeeno,
      CASE l.legislativebody
        WHEN 'S' THEN 'Senate'
        WHEN 'H' THEN 'House'
        ELSE l.legislativebody
      END AS chamber,
      l.firstname || ' ' || l.lastname AS name,
      l.firstname,
      l.lastname,
      l.party,
      COALESCE(p.photo_url, '') AS photo,
      l.emailaddress AS email,
      l.district AS raw_district,
      l.countycode
    FROM d1_legislators l
    LEFT JOIN d1_legislator_photos p
      ON p.employeeno = l.employeeno
    WHERE l.active = 1
      AND l.legislativebody = ?
      AND CAST(l.district AS INTEGER) = ?
  `;

  const binds = [district.body, district.district_number];

  if (district.body === "H") {
    sql += ` AND CAST(l.countycode AS INTEGER) = ?`;
    binds.push(district.county_number);
  }

  sql += ` ORDER BY l.lastname, l.firstname`;

  const result = await env.DB.prepare(sql).bind(...binds).all();

  return (result.results || []).map((rep) => ({
    ...rep,
    sourceUrls: {
      generalCourt: buildGeneralCourtUrl(rep),
      photo: rep.photo || null,
    },
  }));
}

async function getArticlesForCommunityPreview(
  env,
  district,
  representatives,
  limit
) {
  if (!limit) return [];

  const towns = getCommunityArticleSearchTerms(district);
  const personids = representatives.map((rep) => rep.personid).filter(Boolean);
  const employeenos = representatives
    .map((rep) => rep.employeeno)
    .filter(Boolean);

  const conditions = [];
  const binds = [];

  if (towns.length) {
    conditions.push(
      `LOWER(at.town) IN (${towns.map(() => "?").join(", ")})`
    );
    binds.push(...towns);
  }

  if (personids.length) {
    conditions.push(
      `al.personid IN (${personids.map(() => "?").join(", ")})`
    );
    binds.push(...personids);
  }

  if (employeenos.length) {
    conditions.push(
      `al.employeeno IN (${employeenos.map(() => "?").join(", ")})`
    );
    binds.push(...employeenos);
  }

  if (!conditions.length) return [];

  const result = await env.DB.prepare(`
    SELECT DISTINCT
      a.article_id,
      a.title,
      a.resource_type,
      a.publisher,
      a.url,
      a.summary,
      a.created_at,
      a.updated_at
    FROM d1_articles a
    LEFT JOIN d1_article_towns at
      ON at.article_id = a.article_id
    LEFT JOIN d1_article_legislators al
      ON al.article_id = a.article_id
    WHERE ${conditions.map((condition) => `(${condition})`).join(" OR ")}
    ORDER BY a.created_at DESC, a.title
    LIMIT ?
  `)
    .bind(...binds, limit)
    .all();

  return result.results || [];
}

function splitCommunityList(value) {
  return String(value || "")
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function getCommunityArticleSearchTerms(district) {
  const terms = new Set();

  for (const town of splitCommunityList(
    district.communities_represented || district.towns_represented
  )) {
    const normalized = normalizeCommunityText(town);
    if (!normalized) continue;

    terms.add(normalized);
    terms.add(normalized.replace(/\s+ward\s+\d+$/i, "").trim());
    terms.add(normalized.replace(/\s+wards?\s+\d+.*$/i, "").trim());
  }

  return [...terms].filter(Boolean).slice(0, 50);
}

function parseBooleanText(value) {
  if (value === null || value === undefined || value === "") return null;
  return String(value).toLowerCase() === "true";
}

function summarizeParties(representatives) {
  return representatives.reduce((summary, rep) => {
    const party = rep.party || "Unknown";
    summary[party] = (summary[party] || 0) + 1;
    return summary;
  }, {});
}

function boundedNumber(value, fallback, min, max) {
  const number = Number(value ?? fallback);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(number, min), max);
}

function normalizeCommunityPathPart(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-")
    .replace(/\s+/g, "-");
}

async function getArticlesForLegislator(env, personid, employeeno, limit = 10) {
  const result = await env.DB.prepare(`
    SELECT DISTINCT
      a.article_id,
      a.title,
      a.resource_type,
      a.publisher,
      a.url,
      a.summary,
      a.created_at,
      a.updated_at
    FROM d1_articles a
    JOIN d1_article_legislators al
      ON al.article_id = a.article_id
    WHERE al.personid = ?
      OR al.employeeno = ?
    ORDER BY a.created_at DESC, a.title
    LIMIT ?
  `)
    .bind(personid, employeeno, limit)
    .all();

  return result.results || [];
}

async function handleTownSearch(request, env) {
  const url = new URL(request.url);
  const town = url.searchParams.get("town");
  const voteLimit = Number(url.searchParams.get("voteLimit") || 50);

  if (!town) {
    return json({ error: "Town is required." }, 400);
  }

  const reps = await env.DB.prepare(`
    SELECT
      r.personid AS id,
      r.employeeno,
      CASE r.legislativebody
        WHEN 'S' THEN 'Senate'
        WHEN 'H' THEN 'House'
        ELSE r.legislativebody
      END AS chamber,
      r.firstname || ' ' || r.lastname AS name,
      r.firstname,
      r.lastname,
      r.party,
      COALESCE(dm.district_label, r.district) AS district,
      r.district AS raw_district,
      r.countycode,
      COALESCE(dm.communities_represented, r.city, '') AS location_text,
      r.emailaddress AS email,
      '' AS phone,
      COALESCE(p.photo_url, '') AS photo
    FROM d1_legislators r
    LEFT JOIN d1_legislator_photos p
      ON r.employeeno = p.employeeno
    LEFT JOIN d1_district_mapping dm
      ON (
        (
          r.legislativebody = 'H'
          AND dm.body = 'H'
          AND CAST(r.countycode AS INTEGER) = dm.county
          AND CAST(r.district AS INTEGER) = dm.district
        )
        OR
        (
          r.legislativebody = 'S'
          AND dm.body = 'S'
          AND CAST(r.district AS INTEGER) = dm.district
        )
      )
    WHERE LOWER(COALESCE(dm.communities_represented, r.city, '')) LIKE LOWER(?)
      AND r.active = 1
    ORDER BY
      CASE r.legislativebody
        WHEN 'S' THEN 1
        WHEN 'H' THEN 2
        ELSE 3
      END,
      r.lastname,
      r.firstname
  `)
    .bind(`%${town}%`)
    .all();

  const representatives = await attachVoteHistory(env, reps.results, voteLimit);

  return json({
    town,
    representatives,
  });
}

async function handleAddressLookup(request, env) {
  try {
    if (request.method !== "POST") {
      return json({ error: "Method not allowed. Use POST." }, 405);
    }

    const body = await request.json();
    const address = String(body.address || "").trim();
    const url = new URL(request.url);
    const voteLimit = Number(url.searchParams.get("voteLimit") || 50);

    if (!address) {
      return json({ error: "Address is required." }, 400);
    }

    if (!env.CIVIC_API_KEY) {
      return json({ error: "Missing CIVIC_API_KEY secret." }, 500);
    }

    const civicData = await getCivicData(address, env.CIVIC_API_KEY);
    const parsed = parseCivicDivisions(civicData.divisions || {});

    const matchedDistricts = await findDistrictsFromPlace(
      env,
      parsed.place,
      parsed.ward
    );

    const houseDistricts = matchedDistricts.filter((d) => d.body === "H");

    const houseReps = await findHouseRepsFromDistrictMappings(
      env,
      houseDistricts
    );

    const senators = parsed.senate
      ? await findSenators(env, parsed.senate)
      : [];

    const representatives = await attachVoteHistory(
      env,
      [...senators, ...houseReps],
      voteLimit
    );

    return json({
      address,
      normalizedInput: civicData.normalizedInput || null,
      civic: {
        house: parsed.house,
        senate: parsed.senate,
        place: parsed.place,
        ward: parsed.ward,
      },
      matchedDistricts,
      representatives,
      groups: {
        senate: representatives.filter((r) => r.chamber === "Senate"),
        house: representatives.filter((r) => r.chamber === "House"),
      },
    });
  } catch (error) {
    return json(
      {
        error: error.message || "Unable to look up representatives.",
      },
      500
    );
  }
}
function normalizeBillNumber(value) {
  return String(value || "").trim().toUpperCase();
}

function getBillNumberFromPath(pathname) {
  const parts = pathname.split("/").filter(Boolean);
  return normalizeBillNumber(parts[1]);
}

function getSessionYear(url) {
  return Number(url.searchParams.get("sessionyear") || url.searchParams.get("year") || 2026);
}

async function handleBills(request, env) {
  const url = new URL(request.url);

  const sessionyear = url.searchParams.get("sessionyear") || url.searchParams.get("year");
  const q = normalizeBillNumber(url.searchParams.get("q") || "");
  const limit = Math.min(Number(url.searchParams.get("limit") || 100), 250);
  const offset = Number(url.searchParams.get("offset") || 0);

  let sql = `
    SELECT
      sessionyear,
      legislationid,
      condensedbillno,
      expandedbillno,
      legislativebody,
      description,
      statusdate,
      statusorder,
      testimony_count,
      germane_count,
      nongermane_count,
      support_count,
      oppose_count,
      neutral_count
    FROM d1_bills
    WHERE 1 = 1
  `;

  const binds = [];

  if (sessionyear) {
    sql += ` AND sessionyear = ?`;
    binds.push(Number(sessionyear));
  }

  if (q) {
    sql += `
      AND (
        UPPER(condensedbillno) LIKE ?
        OR UPPER(expandedbillno) LIKE ?
        OR UPPER(description) LIKE ?
      )
    `;
    binds.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }

  sql += `
    ORDER BY sessionyear DESC, statusdate DESC, condensedbillno
    LIMIT ?
    OFFSET ?
  `;

  binds.push(limit, offset);

  const result = await env.DB.prepare(sql).bind(...binds).all();

  return json({
    bills: result.results || [],
    meta: {
      sessionyear: sessionyear ? Number(sessionyear) : null,
      q,
      limit,
      offset,
      count: result.results?.length || 0,
    },
  });
}

async function handleBillDetail(request, env) {
  const url = new URL(request.url);
  const billNumber = getBillNumberFromPath(url.pathname);
  const sessionyear = getSessionYear(url);

  if (!billNumber) {
    return json({ error: "Bill number is required." }, 400);
  }

  const bill = await env.DB.prepare(`
    SELECT
      sessionyear,
      legislationid,
      condensedbillno,
      expandedbillno,
      legislativebody,
      description,
      statusdate,
      statusorder,
      testimony_count,
      germane_count,
      nongermane_count,
      support_count,
      oppose_count,
      neutral_count
    FROM d1_bills
    WHERE sessionyear = ?
      AND (
        UPPER(condensedbillno) = ?
        OR UPPER(expandedbillno) = ?
      )
    LIMIT 1
  `)
    .bind(sessionyear, billNumber, billNumber)
    .first();

  if (!bill) {
    return json({ error: "Bill not found." }, 404);
  }

  const rollCalls = await env.DB.prepare(`
    SELECT
      rs.sessionyear,
      rs.legislativebody,
      rs.votesequencenumber,
      rs.votedate,
      rs.condensedbillno,
      rs.yeas,
      rs.nays,
      rs.present,
      rs.absent,
      rs.question_motion,
      rs.title1,
      rs.title2,
      rs.verified,
      rs.calendaritemid
    FROM d1_rollcallsummary rs
    WHERE rs.sessionyear = ?
      AND UPPER(rs.condensedbillno) = ?
    ORDER BY rs.votedate DESC, rs.votesequencenumber DESC
  `)
    .bind(sessionyear, billNumber)
    .all();

  const relatedArticles = await getArticlesForBill(
  env,
  bill.sessionyear,
  bill.condensedbillno,
  10
  );

  return json({
     bill,
     summary: {
      testimony_count: bill.testimony_count || 0,
      germane_count: bill.germane_count || 0,
      nongermane_count: bill.nongermane_count || 0,
      support_count: bill.support_count || 0,
      oppose_count: bill.oppose_count || 0,
      neutral_count: bill.neutral_count || 0,
    },
    rollCalls: rollCalls.results || [],
    relatedArticles,
    links: {
      testimony: `/bills/${bill.condensedbillno}/testimony?sessionyear=${bill.sessionyear}`,
      articles: `/articles?bill=${bill.condensedbillno}&include=relations`,
    },
  });
}

async function getArticlesForBill(env, sessionyear, billNumber, limit = 10) {
  const result = await env.DB.prepare(`
    SELECT DISTINCT
      a.article_id,
      a.title,
      a.resource_type,
      a.publisher,
      a.url,
      a.summary,
      a.created_at,
      a.updated_at
    FROM d1_articles a
    JOIN d1_article_bills ab
      ON ab.article_id = a.article_id
    WHERE ab.sessionyear = ?
      AND UPPER(ab.condensedbillno) = UPPER(?)
    ORDER BY a.created_at DESC, a.title
    LIMIT ?
  `)
    .bind(sessionyear, billNumber, limit)
    .all();

  return result.results || [];
}

async function handleBillTestimony(request, env) {
  const url = new URL(request.url);
  const billNumber = getBillNumberFromPath(url.pathname);
  const sessionyear = getSessionYear(url);
  const limit = Math.min(Number(url.searchParams.get("limit") || 100), 500);
  const offset = Number(url.searchParams.get("offset") || 0);
  const germane = url.searchParams.get("germane");

  if (!billNumber) {
    return json({ error: "Bill number is required." }, 400);
  }

  let sql = `
    SELECT
      id,
      firstname,
      lastname,
      committeedate,
      legislationid,
      sessionyear,
      condensedbillno,
      expandedbillno,
      committeename,
      longname,
      committeeid,
      whoisname,
      representing,
      town,
      state,
      nongermane,
      expr1,
      expr2,
      testimonytext
    FROM d1_testimony
    WHERE sessionyear = ?
      AND (
        UPPER(condensedbillno) = ?
        OR UPPER(expandedbillno) = ?
      )
  `;

  const binds = [sessionyear, billNumber, billNumber];

  if (germane === "true") {
    sql += ` AND COALESCE(nongermane, 0) = 0`;
  }

  if (germane === "false") {
    sql += ` AND COALESCE(nongermane, 0) = 1`;
  }

  sql += `
    ORDER BY committeedate DESC, lastname, firstname
    LIMIT ?
    OFFSET ?
  `;

  binds.push(limit, offset);

  const result = await env.DB.prepare(sql).bind(...binds).all();

  return json({
    bill: {
      sessionyear,
      billNumber,
    },
    testimony: result.results || [],
    meta: {
      limit,
      offset,
      count: result.results?.length || 0,
      germane:
        germane === "true"
          ? true
          : germane === "false"
            ? false
            : null,
    },
  });
}

async function getCivicData(address, apiKey) {
  const civicUrl =
    "https://civicinfo.googleapis.com/civicinfo/v2/divisionsByAddress?address=" +
    encodeURIComponent(address) +
    "&key=" +
    encodeURIComponent(apiKey);

  const response = await fetch(civicUrl);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error?.message || "Google Civic lookup failed.");
  }

  return data;
}

function parseCivicDivisions(divisions) {
  const entries = Object.entries(divisions || {});

  let house = null;
  let senate = null;
  let place = null;
  let ward = null;

  for (const [ocdId, info] of entries) {
    const name = info?.name || "";

    if (ocdId.includes("/sldl:")) {
      house = parseHouseDistrict(ocdId, name);
    }

    if (ocdId.includes("/sldu:")) {
      senate = parseSenateDistrict(ocdId, name);
    }

    if (ocdId.includes("/place:") && !place) {
      place = {
        ocdId,
        name: name.replace(/\s+(city|town)$/i, "").trim(),
      };
    }

    if (ocdId.includes("/ward:") && !ward) {
      const match =
        ocdId.match(/\/ward:(\d+)/i) ||
        name.match(/ward\s+(\d+)/i);

      ward = {
        ocdId,
        name,
        number: match ? Number(match[1]) : null,
      };
    }
  }

  return {
    house,
    senate,
    place,
    ward,
  };
}

function parseHouseDistrict(ocdId, name) {
  const raw = decodeURIComponent(
    (ocdId.match(/\/sldl:([^/]+)/i) || [])[1] || ""
  );

  const districtMatch = raw.match(/(\d+)$/);
  const district = districtMatch ? Number(districtMatch[1]) : null;

  const countyName = raw
    .replace(/[_-]?\d+$/g, "")
    .replace(/_/g, " ")
    .trim();

  const county = countyNameToNumber(countyName);

  return {
    ocdId,
    name,
    raw,
    body: "H",
    county,
    district,
    districtLabel: county
      ? `${countyCodeFromNumber(county)} ${district}`
      : String(district || ""),
  };
}

function parseSenateDistrict(ocdId, name) {
  const raw = decodeURIComponent(
    (ocdId.match(/\/sldu:([^/]+)/i) || [])[1] || ""
  );

  const districtMatch = raw.match(/(\d+)$/);
  const district = districtMatch ? Number(districtMatch[1]) : null;

  return {
    ocdId,
    name,
    raw,
    body: "S",
    county: null,
    district,
    districtLabel: String(district || ""),
  };
}

function countyNameToNumber(value) {
  const normalized = String(value || "")
    .toLowerCase()
    .replace(/county/g, "")
    .replace(/[^a-z]/g, "")
    .trim();

  const map = {
    belknap: 1,
    carroll: 2,
    cheshire: 3,
    coos: 4,
    grafton: 5,
    hillsborough: 6,
    merrimack: 7,
    rockingham: 8,
    strafford: 9,
    sullivan: 10,
  };

  return map[normalized] || null;
}

function countyCodeFromNumber(county) {
  const map = {
    1: "BEL",
    2: "CAR",
    3: "CHE",
    4: "COO",
    5: "GRA",
    6: "HIL",
    7: "MER",
    8: "ROC",
    9: "STR",
    10: "SUL",
  };

  return map[county] || "";
}

function normalizeCommunityText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getArticleIdFromPath(pathname) {
  const parts = pathname.split("/").filter(Boolean);
  return parts[1] || "";
}

async function hydrateArticles(env, articles) {
  const hydrated = [];

  for (const article of articles || []) {
    const article_id = article.article_id;

    const [towns, legislators, issueAreas, impactTypes, bills] =
      await Promise.all([
        env.DB.prepare(`
          SELECT town
          FROM d1_article_towns
          WHERE article_id = ?
          ORDER BY town
        `).bind(article_id).all(),

        env.DB.prepare(`
          SELECT
            al.personid,
            al.employeeno,
            al.legislator_name_raw,
            l.firstname || ' ' || l.lastname AS matched_name,
            l.party,
            CASE l.legislativebody
              WHEN 'S' THEN 'Senate'
              WHEN 'H' THEN 'House'
              ELSE l.legislativebody
            END AS chamber
          FROM d1_article_legislators al
          LEFT JOIN d1_legislators l
            ON l.personid = al.personid
            OR l.employeeno = al.employeeno
          WHERE al.article_id = ?
          ORDER BY legislator_name_raw
        `).bind(article_id).all(),

        env.DB.prepare(`
          SELECT issue_area
          FROM d1_article_issue_areas
          WHERE article_id = ?
          ORDER BY issue_area
        `).bind(article_id).all(),

        env.DB.prepare(`
          SELECT impact_type
          FROM d1_article_impact_types
          WHERE article_id = ?
          ORDER BY impact_type
        `).bind(article_id).all(),

        env.DB.prepare(`
          SELECT
            ab.sessionyear,
            ab.condensedbillno,
            ab.legislationid,
            ab.bill_label_raw,
            b.expandedbillno,
            b.description
          FROM d1_article_bills ab
          LEFT JOIN d1_bills b
            ON b.sessionyear = ab.sessionyear
            AND (
              b.legislationid = ab.legislationid
              OR UPPER(b.condensedbillno) = UPPER(ab.condensedbillno)
            )
          WHERE ab.article_id = ?
          ORDER BY ab.sessionyear DESC, ab.condensedbillno
        `).bind(article_id).all(),
      ]);

    hydrated.push({
      ...article,
      towns: towns.results || [],
      legislators: legislators.results || [],
      issueAreas: issueAreas.results || [],
      impactTypes: impactTypes.results || [],
      bills: bills.results || [],
    });
  }

  return hydrated;
}

function buildCommunitySearchTerms(place, ward) {
  const placeName = normalizeCommunityText(place?.name || "");
  const wardNumber = ward?.number ? String(ward.number).trim() : "";

  if (!placeName) return [];

  if (wardNumber) {
    return [
      `${placeName} ward ${wardNumber}`,
      `${placeName} wards ${wardNumber}`,
    ];
  }

  return [placeName];
}

async function findDistrictsFromPlace(env, place, ward) {
  const placeName = normalizeCommunityText(place?.name || "");
  const wardNumber = ward?.number ? String(ward.number).trim() : "";

  if (!placeName) return [];

  let result;

  if (wardNumber) {
    result = await env.DB.prepare(`
      SELECT
        body,
        county,
        district,
        district_label,
        communities_represented
      FROM d1_district_mapping
      WHERE LOWER(communities_represented) LIKE LOWER(?)
        AND (
          LOWER(communities_represented) LIKE LOWER(?)
          OR LOWER(communities_represented) LIKE LOWER(?)
          OR LOWER(communities_represented) LIKE LOWER(?)
          OR LOWER(communities_represented) LIKE LOWER(?)
        )
      ORDER BY
        CASE body
          WHEN 'S' THEN 1
          WHEN 'H' THEN 2
          ELSE 3
        END,
        county,
        district
    `)
      .bind(
        `%${placeName}%`,
        `%ward ${wardNumber}%`,
        `%wards ${wardNumber},%`,
        `%wards ${wardNumber} %`,
        `% ${wardNumber},%`
      )
      .all();
  } else {
    result = await env.DB.prepare(`
      SELECT
        body,
        county,
        district,
        district_label,
        communities_represented
      FROM d1_district_mapping
      WHERE LOWER(communities_represented) LIKE LOWER(?)
      ORDER BY
        CASE body
          WHEN 'S' THEN 1
          WHEN 'H' THEN 2
          ELSE 3
        END,
        county,
        district
    `)
      .bind(`%${placeName}%`)
      .all();
  }

  const seen = new Set();

  return result.results.filter((row) => {
    const key = `${row.body}_${row.county}_${row.district}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function findHouseRepsFromDistrictMappings(env, districts) {
  if (!districts.length) return [];

  const reps = [];

  for (const district of districts) {
    const result = await env.DB.prepare(`
      SELECT
        l.personid AS id,
        l.employeeno,
        'House' AS chamber,
        l.firstname || ' ' || l.lastname AS name,
        l.firstname,
        l.lastname,
        l.party,
        COALESCE(dm.district_label, l.district) AS district,
        l.district AS raw_district,
        l.countycode,
        COALESCE(dm.communities_represented, l.city, '') AS location_text,
        l.emailaddress AS email,
        '' AS phone,
        COALESCE(p.photo_url, '') AS photo
      FROM d1_legislators l
      LEFT JOIN d1_district_mapping dm
        ON dm.body = 'H'
        AND CAST(l.countycode AS INTEGER) = dm.county
        AND CAST(l.district AS INTEGER) = dm.district
      LEFT JOIN d1_legislator_photos p
        ON p.employeeno = l.employeeno
      WHERE l.active = 1
        AND l.legislativebody = 'H'
        AND CAST(l.countycode AS INTEGER) = ?
        AND CAST(l.district AS INTEGER) = ?
      ORDER BY l.lastname, l.firstname
    `)
      .bind(district.county, district.district)
      .all();

    reps.push(...result.results);
  }

  return dedupeReps(reps);
}

async function findSenators(env, senate) {
  if (!senate || !senate.district) return [];

  const result = await env.DB.prepare(`
    SELECT
      l.personid AS id,
      l.employeeno,
      'Senate' AS chamber,
      l.firstname || ' ' || l.lastname AS name,
      l.firstname,
      l.lastname,
      l.party,
      COALESCE(dm.district_label, l.district) AS district,
      l.district AS raw_district,
      l.countycode,
      COALESCE(dm.communities_represented, l.city, '') AS location_text,
      l.emailaddress AS email,
      '' AS phone,
      COALESCE(p.photo_url, '') AS photo
    FROM d1_legislators l
    LEFT JOIN d1_district_mapping dm
      ON dm.body = 'S'
      AND CAST(l.district AS INTEGER) = dm.district
    LEFT JOIN d1_legislator_photos p
      ON p.employeeno = l.employeeno
    WHERE l.active = 1
      AND l.legislativebody = 'S'
      AND CAST(l.district AS INTEGER) = ?
    ORDER BY l.lastname, l.firstname
  `)
    .bind(senate.district)
    .all();

  return dedupeReps(result.results);
}

function dedupeReps(reps) {
  const seen = new Set();

  return reps.filter((rep) => {
    const key = rep.id || rep.employeeno || rep.name;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function attachVoteHistory(env, reps, limit = 50) {
  const enriched = [];

  for (const rep of reps || []) {
    enriched.push({
      ...rep,
      voteHistory: rep.employeeno
        ? await getVoteHistoryForRep(env, rep.employeeno, limit)
        : [],
    });
  }

  return enriched;
}

async function handleRepVotes(request, env) {
  const url = new URL(request.url);
  const parts = url.pathname.split("/");
  const employeeno = Number(parts[2]);
  const limit = Number(url.searchParams.get("limit") || 100);

  if (!employeeno) {
    return json({ error: "Valid employeeno is required." }, 400);
  }

  const legislator = await env.DB.prepare(`
    SELECT
      personid AS id,
      employeeno,
      firstname || ' ' || lastname AS name,
      firstname,
      lastname,
      party,
      legislativebody,
      district,
      countycode
    FROM d1_legislators
    WHERE employeeno = ?
    LIMIT 1
  `)
    .bind(employeeno)
    .first();

  if (!legislator) {
    return json({ error: "Legislator not found." }, 404);
  }

  const voteHistory = await getVoteHistoryForRep(env, employeeno, limit);

  return json({
    legislator,
    voteHistory,
  });
}
async function handleArticles(request, env) {
  const url = new URL(request.url);

  const q = String(url.searchParams.get("q") || "").trim();
  const town = String(url.searchParams.get("town") || "").trim();
  const personid = url.searchParams.get("personid");
  const employeeno = url.searchParams.get("employeeno");
  const bill = normalizeBillNumber(url.searchParams.get("bill") || "");
  const issue = String(url.searchParams.get("issue") || "").trim();
  const impact = String(url.searchParams.get("impact") || "").trim();
  const resourceType = String(url.searchParams.get("type") || "").trim();
  const limit = Math.min(Number(url.searchParams.get("limit") || 50), 200);
  const offset = Number(url.searchParams.get("offset") || 0);
  const include = String(url.searchParams.get("include") || "").toLowerCase();

  let sql = `
    SELECT DISTINCT
      a.article_id,
      a.title,
      a.resource_type,
      a.publisher,
      a.url,
      a.summary,
      a.created_at,
      a.updated_at
    FROM d1_articles a
    LEFT JOIN d1_article_towns at
      ON at.article_id = a.article_id
    LEFT JOIN d1_article_legislators al
      ON al.article_id = a.article_id
    LEFT JOIN d1_article_issue_areas ai
      ON ai.article_id = a.article_id
    LEFT JOIN d1_article_impact_types ait
      ON ait.article_id = a.article_id
    LEFT JOIN d1_article_bills ab
      ON ab.article_id = a.article_id
    WHERE 1 = 1
  `;

  const binds = [];

  if (q) {
    const search = `%${q.toUpperCase()}%`;
    sql += `
      AND (
        UPPER(a.title) LIKE ?
        OR UPPER(COALESCE(a.summary, '')) LIKE ?
        OR UPPER(COALESCE(a.publisher, '')) LIKE ?
      )
    `;
    binds.push(search, search, search);
  }

  if (town) {
    sql += ` AND LOWER(at.town) = LOWER(?)`;
    binds.push(town);
  }

  if (personid) {
    sql += ` AND al.personid = ?`;
    binds.push(Number(personid));
  }

  if (employeeno) {
    sql += ` AND al.employeeno = ?`;
    binds.push(Number(employeeno));
  }

  if (bill) {
    sql += ` AND UPPER(ab.condensedbillno) = ?`;
    binds.push(bill);
  }

  if (issue) {
    sql += ` AND LOWER(ai.issue_area) = LOWER(?)`;
    binds.push(issue);
  }

  if (impact) {
    sql += ` AND LOWER(ait.impact_type) = LOWER(?)`;
    binds.push(impact);
  }

  if (resourceType) {
    sql += ` AND LOWER(a.resource_type) = LOWER(?)`;
    binds.push(resourceType);
  }

  sql += `
    ORDER BY a.created_at DESC, a.title
    LIMIT ?
    OFFSET ?
  `;

  binds.push(limit, offset);

  const result = await env.DB.prepare(sql).bind(...binds).all();
  const articles =
    include === "relations"
      ? await hydrateArticles(env, result.results || [])
      : result.results || [];

  return json({
    articles,
    meta: {
      q,
      town,
      personid: personid ? Number(personid) : null,
      employeeno: employeeno ? Number(employeeno) : null,
      bill,
      issue,
      impact,
      resourceType,
      limit,
      offset,
      count: articles.length,
    },
  });
}

async function handleArticleDetail(request, env) {
  const url = new URL(request.url);
  const articleId = getArticleIdFromPath(url.pathname);

  if (!articleId) {
    return json({ error: "Article ID is required." }, 400);
  }

  const article = await env.DB.prepare(`
    SELECT
      article_id,
      title,
      resource_type,
      publisher,
      url,
      summary,
      created_at,
      updated_at
    FROM d1_articles
    WHERE article_id = ?
    LIMIT 1
  `)
    .bind(articleId)
    .first();

  if (!article) {
    return json({ error: "Article not found." }, 404);
  }

  const [hydrated] = await hydrateArticles(env, [article]);

  return json({
    article: hydrated,
  });
}


async function getVoteHistoryForRep(env, employeeno, limit = 50) {
  const result = await env.DB.prepare(`
    SELECT
      h.sessionyear,
      h.legislativebody,
      h.votesequencenumber,
      h.condensedbillno,

      h.vote AS vote_code,

      CASE h.vote
        WHEN 1 THEN 'yea'
        WHEN 2 THEN 'nay'
        WHEN 3 THEN 'absent'
        WHEN 4 THEN 'present'
        WHEN 5 THEN 'other_not_voting'
        WHEN 6 THEN 'other_present_not_voting'
        WHEN 7 THEN 'other_present_not_voting'
        WHEN 0 THEN 'other_not_counted'
        ELSE 'unknown'
      END AS vote,

      rs.question_motion,

      CASE
        WHEN h.vote = 1
          AND (
            UPPER(COALESCE(rs.question_motion, '')) LIKE '%OUGHT TO PASS%'
            OR UPPER(COALESCE(rs.question_motion, '')) LIKE '%OTPA%'
            OR UPPER(COALESCE(rs.question_motion, '')) LIKE '%OTP%'
          )
        THEN 'In Support'

        WHEN h.vote = 2
          AND (
            UPPER(COALESCE(rs.question_motion, '')) LIKE '%OUGHT TO PASS%'
            OR UPPER(COALESCE(rs.question_motion, '')) LIKE '%OTPA%'
            OR UPPER(COALESCE(rs.question_motion, '')) LIKE '%OTP%'
          )
        THEN 'Against'

        WHEN h.vote = 1
          AND UPPER(COALESCE(rs.question_motion, '')) LIKE '%ITL%'
        THEN 'Against'

        WHEN h.vote = 2
          AND UPPER(COALESCE(rs.question_motion, '')) LIKE '%ITL%'
        THEN 'In Support'

        ELSE 'N/A'
      END AS vote_label,

      h.calendaritemid,
      b.expandedbillno,
      b.description,
      b.statusdate,
      b.statusorder
    FROM d1_rollcallhistory h
    LEFT JOIN d1_rollcallsummary rs
      ON rs.sessionyear = h.sessionyear
      AND rs.legislativebody = h.legislativebody
      AND rs.votesequencenumber = h.votesequencenumber
    LEFT JOIN d1_bills b
      ON b.sessionyear = h.sessionyear
      AND b.condensedbillno = h.condensedbillno
      AND b.legislativebody = h.legislativebody
    WHERE h.employeenumber = ?
    ORDER BY h.sessionyear DESC, h.votesequencenumber DESC
    LIMIT ?
  `)
    .bind(employeeno, limit)
    .all();

  return result.results || [];
}

async function handlePhotoSync(request, env) {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed. Use POST." }, 405);
  }

  const secret = request.headers.get("x-admin-secret");

  if (!env.ADMIN_SECRET || secret !== env.ADMIN_SECRET) {
    return json({ error: "Unauthorized" }, 401);
  }

  if (!env.LEGISLATOR_PHOTOS) {
    return json({ error: "Missing LEGISLATOR_PHOTOS R2 binding." }, 500);
  }

  let cursor = undefined;
  let totalObjects = 0;
  let matched = 0;
  const skipped = [];

  do {
    const listed = await env.LEGISLATOR_PHOTOS.list({
      cursor,
      limit: 1000,
    });

    for (const object of listed.objects) {
      totalObjects++;

      const key = object.key;
      const filename = key.split("/").pop();

      const match = filename.match(/^(\d+)_/);

      if (!match) {
        skipped.push({
          key,
          reason: "Filename does not start with employeeno_",
        });
        continue;
      }

      const employeeno = Number(match[1]);

      const legislator = await env.DB.prepare(`
        SELECT
          personid,
          employeeno,
          firstname,
          lastname
        FROM d1_legislators
        WHERE employeeno = ?
        LIMIT 1
      `)
        .bind(employeeno)
        .first();

      if (!legislator) {
        skipped.push({
          key,
          employeeno,
          reason: "No matching legislator found",
        });
        continue;
      }

      const photoUrl = `https://photos.nhdeservesbetter.com/${encodeURI(key)}`;

      await env.DB.prepare(`
        INSERT OR REPLACE INTO d1_legislator_photos (
          employeeno,
          personid,
          firstname,
          lastname,
          filename,
          photo_url,
          source,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `)
        .bind(
          legislator.employeeno,
          legislator.personid,
          legislator.firstname,
          legislator.lastname,
          filename,
          photoUrl,
          "r2_filename"
        )
        .run();

      matched++;
    }

    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);

  return json({
    status: "ok",
    totalObjects,
    matched,
    skippedCount: skipped.length,
    skipped: skipped.slice(0, 50),
  });
}
