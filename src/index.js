const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, x-api-key, x-admin-secret",
};

const DEFAULT_BILL_TRACKER_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vTHKkGGONM78RXb63Igvi2BXipOA4pV4X5CBY6yHaVAizO-l0q_WtU8uyXI-vhxxbKEib9nFlL1nIBz/pub?gid=1337871563&single=true&output=csv";

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
  });
}

function html(source, headers = {}, status = 200) {
  return new Response(source, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      ...corsHeaders,
      ...headers,
    },
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function requireApiKeyForProtectedEndpoint(request, env, url) {
  if (!isProtectedApiEndpoint(url.pathname)) return null;

  if (!env.API_ACCESS_KEY) {
    return json({ error: "Missing API_ACCESS_KEY secret." }, 500);
  }

  const providedKey = getRequestApiKey(request);
  if (!providedKey) {
    return json({ error: "API key is required." }, 401);
  }

  if (!(await timingSafeEqualString(providedKey, env.API_ACCESS_KEY))) {
    return json({ error: "Invalid API key." }, 403);
  }

  return null;
}

function isProtectedApiEndpoint(pathname) {
  if (pathname === "/articles" || pathname.startsWith("/articles/")) return true;
  if (pathname === "/communities" || pathname.startsWith("/communities/")) return true;
  if (pathname === "/candidates" || pathname.startsWith("/candidates/")) return true;
  if (pathname === "/bills" || pathname.startsWith("/bills/")) return true;
  if (pathname === "/reps/search") return true;
  if (pathname === "/reps/lookup" || pathname === "/reps/lookup-address") return true;
  if (pathname.startsWith("/reps/")) return true;

  return false;
}

function getRequestApiKey(request) {
  const headerKey = request.headers.get("x-api-key");
  if (headerKey) return headerKey.trim();

  const authorization = request.headers.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

async function timingSafeEqualString(actual, expected) {
  const encoder = new TextEncoder();
  const [actualHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(String(actual))),
    crypto.subtle.digest("SHA-256", encoder.encode(String(expected))),
  ]);
  const actualBytes = new Uint8Array(actualHash);
  const expectedBytes = new Uint8Array(expectedHash);
  let diff = actualBytes.length ^ expectedBytes.length;

  for (let index = 0; index < actualBytes.length; index += 1) {
    diff |= actualBytes[index] ^ expectedBytes[index];
  }

  return diff === 0;
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

    const authError = await requireApiKeyForProtectedEndpoint(
      request,
      env,
      url
    );
    if (authError) return authError;

    if (url.pathname === "/") {
      return json({
        name: "NH Deserves Better API",
        status: "ok",
        endpoints: [
          "/tools",
          "/communities",
          "/communities/counties/{county}",
          "/communities/towns/{town}",
          "/communities/house/{county}/{district}",
          "/communities/senate/{district}",
          "/candidates",
          "/candidates/{slug-or-filer-entity-number}",
          "/reps/search?town=Manchester",
          "/reps/lookup",
          "/reps/{employeeno}/votes",
          "/bills",
          "/widgets/voting-info",
          "/widgets/voting-info.js",
          "/widgets/voting-info/lookup",
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

    if (url.pathname === "/widgets/voting-info") {
      return handleVotingWidgetPage(request, env);
    }

    if (url.pathname === "/widgets/voting-info.js") {
      return handleVotingWidgetScript(request);
    }

    if (url.pathname === "/widgets/voting-info/lookup") {
      return handleVotingWidgetLookup(request, env);
    }

    if (url.pathname === "/communities") {
      return handleCommunities(request, env);
    }

    if (url.pathname.startsWith("/communities/counties/")) {
      return handleCommunityCounty(request, env);
    }

    if (url.pathname.startsWith("/communities/towns/")) {
      return handleCommunityTown(request, env);
    }

    if (url.pathname.startsWith("/communities/")) {
      return handleCommunityDetail(request, env);
    }

    if (url.pathname === "/candidates") {
      return handleCandidates(request, env);
    }

    if (url.pathname.startsWith("/candidates/")) {
      return handleCandidateDetail(request, env);
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

function javascript(source) {
  return new Response(source, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      ...corsHeaders,
    },
  });
}

async function handleVotingWidgetPage(request, env) {
  const url = new URL(request.url);
  let partner;
  try {
    partner = await resolvePartnerConfig(
      env,
      url.searchParams.get("partner"),
      true
    );
  } catch (error) {
    return html(
      `<!doctype html><meta charset="utf-8"><p>${escapeHtml(error.message)}</p>`,
      {},
      400
    );
  }

  const trackerUrl =
    partner.allowedTrackerUrls[0] ||
    url.searchParams.get("billTrackerUrl") ||
    url.searchParams.get("tracker");
  const title =
    url.searchParams.get("title") ||
    `${partner.name} voting guide`;
  const buttonText =
    url.searchParams.get("buttonText") || "Find my representatives";
  const frameAncestors = {
    "Content-Security-Policy": `frame-ancestors ${partner.allowedOrigins.join(" ")}`,
  };

  return html(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    html, body { margin: 0; padding: 0; background: transparent; }
    html, body { min-height: 1200px; overflow-y: auto; }
    [data-nhcc-voting-widget] { display: block; }
  </style>
</head>
<body>
  <div
    data-nhcc-voting-widget
    data-partner="${escapeHtml(partner.id)}"
    data-bill-tracker-url="${escapeHtml(trackerUrl)}"
    data-title="${escapeHtml(title)}"
    data-button-text="${escapeHtml(buttonText)}"
  ></div>
  <script src="/widgets/voting-info.js"></script>
  <script>
    (() => {
      const notifyHeight = () => {
        const height = Math.ceil(Math.max(
          document.documentElement.scrollHeight || 0,
          document.documentElement.offsetHeight || 0,
          document.body?.scrollHeight || 0,
          document.body?.offsetHeight || 0
        ));
        window.parent?.postMessage({ type: "nhcc:voting-widget:height", height }, "*");
      };
      if ("ResizeObserver" in window) {
        new ResizeObserver(notifyHeight).observe(document.body);
        new ResizeObserver(notifyHeight).observe(document.documentElement);
      }
      window.addEventListener("load", notifyHeight);
      window.addEventListener("resize", notifyHeight);
      document.addEventListener("toggle", notifyHeight, true);
      document.addEventListener("click", () => setTimeout(notifyHeight, 80), true);
      setTimeout(notifyHeight, 250);
      setTimeout(notifyHeight, 1000);
    })();
  </script>
</body>
</html>`, frameAncestors);
}

function handleVotingWidgetScript(request) {
  const origin = new URL(request.url).origin;

  return javascript(`(() => {
  const currentScript = document.currentScript;
  const defaultApiBase = ${JSON.stringify(origin)};
  const defaultTrackerUrl = ${JSON.stringify(DEFAULT_BILL_TRACKER_URL)};

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function attrs(node) {
    return {
      apiBase: node.dataset.apiBase || currentScript?.dataset.apiBase || defaultApiBase,
      partner: node.dataset.partner || currentScript?.dataset.partner || "",
      trackerUrl: node.dataset.billTrackerUrl || currentScript?.dataset.billTrackerUrl || defaultTrackerUrl,
      title: node.dataset.title || currentScript?.dataset.title || "How did my representatives vote?",
      buttonText: node.dataset.buttonText || currentScript?.dataset.buttonText || "Find my representatives"
    };
  }

  function ensureContainer() {
    if (document.querySelector("[data-nhcc-voting-widget]:not(script)")) return;
    if (!currentScript?.hasAttribute("data-nhcc-voting-widget") && !currentScript?.dataset.billTrackerUrl) return;

    const node = document.createElement("div");
    node.dataset.nhccVotingWidget = "";
    for (const key of ["apiBase", "partner", "billTrackerUrl", "title", "buttonText"]) {
      if (currentScript.dataset[key]) node.dataset[key] = currentScript.dataset[key];
    }
    currentScript.insertAdjacentElement("beforebegin", node);
  }

  function getTone(text) {
    const lower = String(text || "").toLowerCase();
    if (lower.startsWith("pro-") || lower.includes(" pro-") || lower.includes(" pro ")) return "pro";
    if (lower.startsWith("anti-") || lower.includes(" anti-") || lower.includes(" anti ")) return "anti";
    return "mix";
  }

  function normalizeVoteStance(value) {
    const lower = String(value || "").trim().toLowerCase();
    if (lower === "yea" || lower === "yes" || lower === "y") return "yea";
    if (lower === "nay" || lower === "no" || lower === "n") return "nay";
    return "";
  }

  function getVoteTone(item) {
    const preferredStance = normalizeVoteStance(item.bill?.preferredStance);
    const vote = normalizeVoteStance(item.vote?.vote);

    if (preferredStance && vote) {
      return preferredStance === vote ? "aligned" : "not-aligned";
    }

    return "neutral";
  }

  function formatVoteLabel(value) {
    const stance = normalizeVoteStance(value);
    if (stance === "yea") return "Yea";
    if (stance === "nay") return "Nay";
    return String(value || "No recorded vote");
  }

  function getPartyLabel(party) {
    const value = String(party || "").trim();
    const lower = value.toLowerCase();
    if (lower === "d" || lower.includes("democrat")) return "Democrat";
    if (lower === "r" || lower.includes("republican")) return "Republican";
    if (lower === "i" || lower.includes("independent")) return "Independent";
    return value || "Unknown";
  }

  function getPartyTone(party) {
    const label = getPartyLabel(party).toLowerCase();
    if (label === "democrat") return "democrat";
    if (label === "republican") return "republican";
    if (label === "independent") return "independent";
    return "other";
  }

  function getDistrictLine(rep) {
    const district = [rep.chamber, rep.district].filter(Boolean).join(" ");
    const towns = rep.location_text || rep.locationText || "";
    if (district && towns) return district + " · " + towns;
    return district || towns || "";
  }

  function isFreeStater(rep) {
    return String(rep.is_free_stater || rep.isFreeStater || "").toLowerCase() === "yes";
  }

  function getBillTitle(bill) {
    const code = String(bill.code || "").trim();
    const name = String(bill.name || code).trim();
    if (!code || !name.toLowerCase().startsWith(code.toLowerCase())) return name;
    return name.slice(code.length).replace(/^\\s*:?\\s*/, "") || name;
  }

  function renderExpandedBillInfo(item) {
    const bill = item.bill || {};
    return \`<div class="nhcc-bill-expanded">
      \${bill.summary ? \`<section class="nhcc-bill-summary">
        <strong>Bill summary</strong>
        <p>\${escapeHtml(bill.summary)}</p>
      </section>\` : ""}
      <div class="nhcc-impact-grid nhcc-impact-grid--compact">
        <div>
          <strong>Yea</strong>
          \${bill.yeaInterpretation ? \`<span>Interpretation</span><p>\${escapeHtml(bill.yeaInterpretation)}</p>\` : ""}
          \${bill.yeaImpact ? \`<span>Impact</span><p>\${escapeHtml(bill.yeaImpact)}</p>\` : ""}
        </div>
        <div>
          <strong>Nay</strong>
          \${bill.nayInterpretation ? \`<span>Interpretation</span><p>\${escapeHtml(bill.nayInterpretation)}</p>\` : ""}
          \${bill.nayImpact ? \`<span>Impact</span><p>\${escapeHtml(bill.nayImpact)}</p>\` : ""}
        </div>
      </div>
      \${bill.moreInfoUrl ? \`<p><a href="\${escapeHtml(bill.moreInfoUrl)}" target="_blank" rel="noopener">More information</a></p>\` : ""}
    </div>\`;
  }

  function percentToLetter(pct) {
    if (pct >= 90) return "A";
    if (pct >= 80) return "B";
    if (pct >= 70) return "C";
    if (pct >= 60) return "D";
    return "F";
  }

  function calcGradeStats(votes) {
    let aligned = 0;
    let notAligned = 0;

    for (const item of votes || []) {
      const preferredStance = normalizeVoteStance(item.bill?.preferredStance);
      const vote = normalizeVoteStance(item.vote?.vote);

      if (!preferredStance || !vote) continue;
      if (preferredStance === vote) aligned += 1;
      else notAligned += 1;
    }

    const counted = aligned + notAligned;
    const pct = counted ? Math.round((aligned / counted) * 100) : 0;

    return {
      aligned,
      notAligned,
      counted,
      pct,
      letter: counted ? percentToLetter(pct) : "—"
    };
  }

  function getIssueList(bills) {
    const issues = new Set();
    for (const bill of bills || []) {
      String(bill.issueArea || "")
        .split(",")
        .map((issue) => issue.trim())
        .filter(Boolean)
        .forEach((issue) => issues.add(issue));
    }
    return [...issues].sort((a, b) => a.localeCompare(b));
  }

  function voteMatchesIssue(item, issue) {
    if (!issue) return true;
    return String(item.bill?.issueArea || "")
      .split(",")
      .map((value) => value.trim())
      .includes(issue);
  }

  function renderVoteTags(rep, issue) {
    const votes = (rep.trackedVotes || []).filter((item) => voteMatchesIssue(item, issue));

    if (!votes.length) {
      return \`<p class="nhcc-empty">No tracked votes match this issue filter.</p>\`;
    }

    return \`<div class="nhcc-vote-tags">\${votes.map((item) => {
      const vote = item.vote ? formatVoteLabel(item.vote.vote) : "No recorded vote";
      const tone = getVoteTone(item);
      const billTitle = getBillTitle(item.bill);
      const voteChoice = item.interpretation ? \`\${item.interpretation}(\${vote})\` : vote;
      return \`<details
        class="nhcc-vote-tag"
        data-tone="\${escapeHtml(tone)}"
      >
        <summary>
          <span class="nhcc-bill-code">\${escapeHtml(item.bill.code)}</span>
          <strong class="nhcc-bill-title">\${escapeHtml(billTitle)}</strong>
          <span class="nhcc-vote-row">
            <span class="nhcc-vote-kicker">Vote</span>
            <span class="nhcc-vote-choice">\${escapeHtml(voteChoice)}</span>
          </span>
          \${item.voteImpact ? \`<p class="nhcc-vote-impact">\${escapeHtml(item.voteImpact)}</p>\` : ""}
        </summary>
        \${renderExpandedBillInfo(item)}
      </details>\`;
    }).join("")}</div>\`;
  }

  function renderRepCard(root, repIndex) {
    const data = root.__nhccData || {};
    const reps = data.representatives || [];
    const rep = reps[Number(repIndex)];
    const card = root.querySelector("[data-rep-card]");

    if (!rep) {
      card.className = "nhcc-rep-card nhcc-rep-card--empty";
      card.innerHTML = "<p>Select a legislator to view their voting record.</p>";
      return;
    }

    const issue = root.querySelector("[data-issue-filter]")?.value || "";
    const visibleVotes = (rep.trackedVotes || []).filter((item) => voteMatchesIssue(item, issue));
    const stats = calcGradeStats(visibleVotes);
    const photo = rep.photo ? \`<img class="nhcc-rep-photo" src="\${escapeHtml(rep.photo)}" alt="">\` : "";
    const partyLabel = getPartyLabel(rep.party);
    const partyTone = getPartyTone(rep.party);
    const districtLine = getDistrictLine(rep);
    const freeStaterTag = isFreeStater(rep)
      ? \`<span class="nhcc-free-stater-tag">Free Stater</span>\`
      : "";

    card.className = "nhcc-rep-card";
    card.innerHTML = \`
      <div class="nhcc-rep-main">
        \${photo}
        <div>
          <h3>\${escapeHtml(rep.name)}</h3>
          <div class="nhcc-rep-meta">
            \${districtLine ? \`<span>\${escapeHtml(districtLine)}</span>\` : ""}
            <span class="nhcc-party-pill nhcc-party-pill--\${escapeHtml(partyTone)}">\${escapeHtml(partyLabel)}</span>
            \${freeStaterTag}
          </div>
          \${rep.email ? \`<p><a href="mailto:\${escapeHtml(rep.email)}">\${escapeHtml(rep.email)}</a></p>\` : ""}
        </div>
      </div>
      <div class="nhcc-grade">
        <span>Alignment grade\${issue ? " · " + escapeHtml(issue) : ""}</span>
        <strong data-grade="\${escapeHtml(stats.letter)}">\${escapeHtml(stats.letter)}</strong>
        <p>\${stats.counted ? escapeHtml(String(stats.pct)) + "% aligned with preferred stances across " + escapeHtml(String(stats.counted)) + " votes" : "Not enough preferred stance votes for this filter"}</p>
      </div>
      <div class="nhcc-vote-label">Tap a bill to expand details.</div>
      \${renderVoteTags(rep, issue)}
    \`;
  }

  function renderResults(root, data) {
    const reps = data.representatives || [];
    root.__nhccBills = data.bills || [];
    root.__nhccData = data;

    root.querySelector("[data-summary]").innerHTML = \`
      <strong>\${escapeHtml(data.normalizedInput?.line1 || data.address)}</strong>
      <span>\${reps.length} legislators found · \${(data.bills || []).length} tracked bills</span>
    \`;

    const divisions = root.querySelector("[data-divisions]");
    const groupMarkup = (label, group) => {
      const people = group || [];
      return \`<div class="nhcc-division">
        <div>
          <strong>\${escapeHtml(label)}</strong>
          <span>\${people.length ? "Who represents you" : "No matches found"}</span>
        </div>
        <div class="nhcc-pill-list">\${people.map((rep) => {
          const index = reps.findIndex((item) => item.employeeno === rep.employeeno);
          return \`<button type="button" class="nhcc-rep-pill" data-rep-index="\${index}">
            \${rep.photo ? \`<img src="\${escapeHtml(rep.photo)}" alt="">\` : ""}
            <span>\${escapeHtml(rep.name)}</span>
          </button>\`;
        }).join("")}</div>
      </div>\`;
    };
    divisions.innerHTML = [
      groupMarkup("State Senator", data.groups?.senate || []),
      groupMarkup("State House Representatives", data.groups?.house || [])
    ].join("");

    const issueFilter = root.querySelector("[data-issue-filter]");
    issueFilter.innerHTML = \`<option value="">All issues</option>\` + getIssueList(data.bills)
      .map((issue) => \`<option value="\${escapeHtml(issue)}">\${escapeHtml(issue)}</option>\`)
      .join("");

    const repSelect = root.querySelector("[data-rep-select]");
    repSelect.innerHTML = \`<option value="">Search or select a name</option>\` + reps
      .map((rep, index) => \`<option value="\${index}">\${escapeHtml(rep.name)} — \${escapeHtml(rep.chamber)}</option>\`)
      .join("");

    root.querySelector("[data-rep-tool]").hidden = false;
    renderRepCard(root, "");
  }

  function billDialog(bill, voteImpact, voteLabel) {
    return \`<div class="nhcc-dialog-backdrop" data-dialog-backdrop>
      <section class="nhcc-dialog" role="dialog" aria-modal="true" aria-labelledby="nhcc-dialog-title">
        <button type="button" class="nhcc-dialog__close" data-dialog-close aria-label="Close">×</button>
        <p class="nhcc-dialog__eyebrow">\${escapeHtml(bill.code)} · \${escapeHtml(bill.issueArea || "Tracked bill")}</p>
        <h3 id="nhcc-dialog-title">\${escapeHtml(bill.name || bill.code)}</h3>
        \${bill.summary ? \`<p>\${escapeHtml(bill.summary)}</p>\` : ""}
        \${voteImpact ? \`<div class="nhcc-selected-impact">
          <strong>\${escapeHtml(voteLabel || "Selected vote")}</strong>
          <p>\${escapeHtml(voteImpact)}</p>
        </div>\` : ""}
        \${bill.moreInfoUrl ? \`<p><a href="\${escapeHtml(bill.moreInfoUrl)}" target="_blank" rel="noopener">More information</a></p>\` : ""}
        <div class="nhcc-impact-grid">
          <div>
            <strong>Yea</strong>
            \${bill.yeaInterpretation ? \`<span>\${escapeHtml(bill.yeaInterpretation)}</span>\` : ""}
            \${bill.yeaImpact ? \`<p>\${escapeHtml(bill.yeaImpact)}</p>\` : ""}
          </div>
          <div>
            <strong>Nay</strong>
            \${bill.nayInterpretation ? \`<span>\${escapeHtml(bill.nayInterpretation)}</span>\` : ""}
            \${bill.nayImpact ? \`<p>\${escapeHtml(bill.nayImpact)}</p>\` : ""}
          </div>
        </div>
      </section>
    </div>\`;
  }

  function openBillDialog(root, billCode, voteImpact, voteLabel) {
    const bill = (root.__nhccBills || []).find((item) => item.code === billCode);
    if (!bill) return;

    const existing = root.querySelector("[data-dialog-backdrop]");
    if (existing) existing.remove();

    root.querySelector(".nhcc-widget").insertAdjacentHTML("beforeend", billDialog(bill, voteImpact, voteLabel));
    root.querySelector("[data-dialog-close]")?.focus();
  }

  function closeBillDialog(root) {
    root.querySelector("[data-dialog-backdrop]")?.remove();
  }

  function mount(node) {
    if (node.__nhccMounted) return;
    node.__nhccMounted = true;
    const config = attrs(node);
    const root = node.attachShadow ? node.attachShadow({ mode: "open" }) : node;

    root.innerHTML = \`
      <style>
        :host, .nhcc-widget { font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #18212f; }
        .nhcc-widget { border: 1px solid rgba(148, 163, 253, .18); border-radius: 18px; padding: 16px; background: #fff; max-width: 900px; box-shadow: 0 8px 24px rgba(15, 23, 42, .06); }
        .nhcc-widget h2, .nhcc-widget h3 { margin: 0 0 6px; line-height: 1.25; }
        .nhcc-widget h2 { font-size: 1.25rem; }
        .nhcc-widget h3 { font-size: 1.05rem; }
        .nhcc-widget p { margin: 0; }
        .nhcc-intro { margin-bottom: 12px; color: #526173; font-size: .92rem; line-height: 1.42; }
        .nhcc-form { display: flex; gap: 8px; align-items: stretch; }
        .nhcc-form input { flex: 1; min-width: 0; border: 1px solid #b8c3d2; border-radius: 6px; padding: 10px 12px; font: inherit; }
        .nhcc-form button { border: 0; border-radius: 6px; padding: 10px 12px; font: inherit; font-weight: 700; background: #174ea6; color: #fff; cursor: pointer; }
        .nhcc-form button:disabled { opacity: .65; cursor: wait; }
        .nhcc-status { margin: 10px 0 0; color: #526173; font-size: .92rem; }
        .nhcc-summary { margin: 16px 0 10px; display: flex; flex-direction: column; gap: 2px; }
        .nhcc-summary span { color: #526173; font-size: .92rem; }
        .nhcc-division { margin-top: 8px; padding: 10px; border: 1px solid #e1e7ef; border-radius: 12px; background: #f9fafb; }
        .nhcc-division > div:first-child { display: flex; flex-direction: column; gap: 2px; margin-bottom: 8px; }
        .nhcc-division span { color: #526173; font-size: .86rem; }
        .nhcc-pill-list { display: flex; flex-wrap: wrap; gap: 8px; }
        .nhcc-rep-pill { display: inline-flex; align-items: center; gap: 7px; border: 1px solid #e1e7ef; border-radius: 999px; padding: 5px 9px 5px 5px; background: #eef2ff; color: #18212f; cursor: pointer; font: inherit; font-size: .86rem; }
        .nhcc-rep-pill img { width: 28px; height: 28px; border-radius: 50%; object-fit: cover; background: #edf1f6; }
        .nhcc-rep-tool { margin-top: 18px; padding-top: 16px; border-top: 1px solid #e1e7ef; }
        .nhcc-controls { display: grid; gap: 10px; margin: 12px 0; }
        .nhcc-control { display: grid; gap: 4px; }
        .nhcc-control label { color: #526173; font-size: .76rem; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
        .nhcc-control select { width: 100%; border: 1px solid #b8c3d2; border-radius: 8px; padding: 10px 12px; background: #fff; font: inherit; }
        .nhcc-control--highlight { padding: 12px; border-radius: 12px; border: 1px solid rgba(79, 70, 229, .25); background: #eef2ff; }
        .nhcc-hint { color: #4338ca; font-size: .84rem; }
        .nhcc-rep-card { border: 1px solid #e1e7ef; border-radius: 14px; padding: 12px; box-shadow: 0 8px 24px rgba(15, 23, 42, .06); }
        .nhcc-rep-card--empty { text-align: center; color: #526173; box-shadow: none; }
        .nhcc-rep-main { display: flex; gap: 12px; align-items: flex-start; margin-bottom: 10px; }
        .nhcc-rep-photo { width: 84px; height: 84px; border-radius: 12px; object-fit: cover; background: #edf1f6; }
        .nhcc-rep-main h3 { margin: 0 0 4px; }
        .nhcc-rep-main p { color: #526173; font-size: .9rem; margin-top: 2px; }
        .nhcc-rep-main a { color: #174ea6; }
        .nhcc-rep-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; color: #526173; font-size: .9rem; margin-top: 2px; }
        .nhcc-party-pill { display: inline-flex; align-items: center; border-radius: 999px; border: 1px solid #e1e7ef; padding: 3px 8px; font-size: .74rem; font-weight: 800; line-height: 1.2; }
        .nhcc-party-pill--democrat { background: #dbeafe; border-color: #bfdbfe; color: #1d4ed8; }
        .nhcc-party-pill--republican { background: #fee2e2; border-color: #fecaca; color: #991b1b; }
        .nhcc-party-pill--independent { background: #fef9c3; border-color: #fde047; color: #854d0e; }
        .nhcc-party-pill--other { background: #f3f4f6; border-color: #e5e7eb; color: #374151; }
        .nhcc-free-stater-tag { display: inline-flex; align-items: center; border-radius: 999px; border: 1px solid #7f1d1d; padding: 4px 9px; background: #450a0a; color: #fee2e2; font-size: .74rem; font-weight: 900; text-transform: uppercase; box-shadow: 0 0 0 2px #fecaca; }
        .nhcc-grade { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px 10px; align-items: center; margin: 10px 0; padding: 10px; border-radius: 12px; border: 1px solid #e1e7ef; background: #f9fafb; }
        .nhcc-grade span { color: #526173; font-size: .78rem; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
        .nhcc-grade strong { display: inline-grid; place-items: center; min-width: 64px; min-height: 56px; border-radius: 16px; padding: 6px 12px; background: #edf1f6; font-size: 2.35rem; line-height: 1; }
        .nhcc-grade strong[data-grade="A"], .nhcc-grade strong[data-grade="B"] { background: #dcfce7; color: #166534; }
        .nhcc-grade strong[data-grade="C"] { background: #fef9c3; color: #854d0e; }
        .nhcc-grade strong[data-grade="D"] { background: #ffedd5; color: #9a3412; }
        .nhcc-grade strong[data-grade="F"] { background: #fee2e2; color: #991b1b; }
        .nhcc-grade p { grid-column: 1 / -1; color: #526173; font-size: .86rem; }
        .nhcc-vote-label { margin: 12px 0 6px; color: #526173; font-size: .78rem; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
        .nhcc-vote-tags { display: grid; gap: 8px; }
        .nhcc-vote-tag { display: block; max-width: 100%; border: 1px solid #e1e7ef; border-radius: 10px; padding: 0; background: #fff; color: #18212f; text-align: left; font: inherit; font-size: .78rem; overflow: hidden; }
        .nhcc-vote-tag summary { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; padding: 10px 12px; cursor: pointer; list-style: none; }
        .nhcc-vote-tag summary::-webkit-details-marker { display: none; }
        .nhcc-vote-tag summary::after { content: "Tap to expand"; color: #526173; font-size: .74rem; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; }
        .nhcc-vote-tag[open] summary::after { content: "Tap to collapse"; }
        .nhcc-bill-code { color: #526173; font-size: .9rem; font-weight: 900; letter-spacing: .08em; text-transform: uppercase; }
        .nhcc-bill-title { color: #174ea6; font-size: 1.08rem; line-height: 1.25; overflow-wrap: anywhere; }
        .nhcc-vote-row { display: inline-flex; align-items: center; gap: 7px; max-width: 100%; }
        .nhcc-vote-kicker { color: #526173; font-size: .72rem; font-weight: 900; letter-spacing: .06em; line-height: 1.1; text-transform: uppercase; }
        .nhcc-vote-choice { display: inline-flex; align-items: center; max-width: 100%; border-radius: 999px; padding: 4px 9px; background: #18212f; color: #fff; font-size: .82rem; font-weight: 900; line-height: 1.1; overflow-wrap: anywhere; }
        .nhcc-vote-impact { max-width: 34rem; color: #344255; font-size: .82rem; line-height: 1.35; }
        .nhcc-bill-expanded { display: grid; gap: 12px; padding: 12px; border-top: 1px solid rgba(148, 163, 184, .35); background: #f8fafc; }
        .nhcc-bill-expanded p { color: #344255; line-height: 1.48; }
        .nhcc-bill-expanded a { color: #174ea6; font-weight: 700; }
        .nhcc-bill-summary { border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; background: #fff; }
        .nhcc-bill-summary strong { display: block; margin-bottom: 6px; color: #18212f; font-size: .82rem; font-weight: 900; letter-spacing: .06em; text-transform: uppercase; }
        .nhcc-bill-summary p { font-size: 1rem; line-height: 1.52; }
        .nhcc-vote-tag em { color: #18212f; font-style: normal; font-weight: 800; }
        .nhcc-vote-tag[data-tone="pro"] { background: #ecfdf3; border-color: #bbf7d0; color: #166534; }
        .nhcc-vote-tag[data-tone="anti"] { background: #fef2f2; border-color: #fecaca; color: #991b1b; }
        .nhcc-vote-tag[data-tone="aligned"] { background: #ecfdf3; border-color: #86efac; color: #166534; }
        .nhcc-vote-tag[data-tone="not-aligned"] { background: #fef2f2; border-color: #fecaca; color: #991b1b; }
        .nhcc-vote-tag[data-tone="neutral"] { background: #eff6ff; border-color: #bfdbfe; color: #1d4ed8; }
        .nhcc-vote-tag[data-tone="pro"] .nhcc-vote-choice { background: #166534; }
        .nhcc-vote-tag[data-tone="anti"] .nhcc-vote-choice { background: #991b1b; }
        .nhcc-vote-tag[data-tone="aligned"] .nhcc-vote-choice { background: #166534; }
        .nhcc-vote-tag[data-tone="not-aligned"] .nhcc-vote-choice { background: #991b1b; }
        .nhcc-vote-tag[data-tone="neutral"] .nhcc-vote-choice { background: #1d4ed8; }
        .nhcc-vote-tag[data-tone="aligned"] .nhcc-vote-impact { color: #166534; }
        .nhcc-vote-tag[data-tone="not-aligned"] .nhcc-vote-impact { color: #991b1b; }
        .nhcc-vote-tag[data-tone="neutral"] .nhcc-vote-impact { color: #1d4ed8; }
        .nhcc-empty { color: #526173; font-size: .92rem; }
        .nhcc-vote { border-radius: 999px; padding: 4px 8px; background: #edf1f6; color: #344255; font-size: .82rem; white-space: nowrap; }
        .nhcc-vote--yea { background: #e7f5ee; color: #146c43; }
        .nhcc-vote--nay { background: #fdecec; color: #b42318; }
        .nhcc-dialog-backdrop { position: fixed; inset: 0; z-index: 2147483000; display: flex; align-items: center; justify-content: center; padding: 16px; background: rgba(24, 33, 47, .46); }
        .nhcc-dialog { position: relative; width: min(680px, 100%); max-height: min(760px, calc(100vh - 32px)); margin: auto; overflow: auto; border-radius: 8px; background: #fff; padding: 18px; box-shadow: 0 20px 70px rgba(24, 33, 47, .32); }
        .nhcc-dialog h3 { margin: 0 32px 10px 0; font-size: 1.2rem; line-height: 1.25; }
        .nhcc-dialog p { color: #344255; line-height: 1.45; }
        .nhcc-dialog a { color: #174ea6; font-weight: 700; }
        .nhcc-dialog__eyebrow { margin: 0 32px 6px 0; color: #526173 !important; font-size: .86rem; font-weight: 700; text-transform: uppercase; letter-spacing: .02em; }
        .nhcc-dialog__close { position: absolute; top: 10px; right: 10px; width: 32px; height: 32px; border: 1px solid #d7dee8; border-radius: 50%; background: #fff; color: #18212f; font-size: 1.35rem; line-height: 1; cursor: pointer; }
        .nhcc-selected-impact { margin: 14px 0; border: 1px solid #cbd5e1; border-radius: 8px; padding: 12px; background: #f1f5f9; color: #334155; }
        .nhcc-selected-impact--inline { margin: 0; background: #eef2ff; border-color: #c7d2fe; color: #3730a3; }
        .nhcc-selected-impact strong { display: block; margin-bottom: 4px; }
        .nhcc-selected-impact p { color: inherit; margin: 0; font-size: .94rem; }
        .nhcc-impact-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 14px; }
        .nhcc-impact-grid--compact { margin-top: 0; }
        .nhcc-impact-grid div { border: 1px solid #e1e7ef; border-radius: 8px; padding: 12px; background: #fff; }
        .nhcc-impact-grid strong { display: block; margin-bottom: 8px; color: #18212f; font-size: 1rem; }
        .nhcc-impact-grid span { display: block; margin-top: 10px; color: #526173; font-size: .72rem; font-weight: 900; letter-spacing: .06em; text-transform: uppercase; }
        .nhcc-impact-grid p { margin: 4px 0 0; font-size: .92rem; }
        @media (max-width: 560px) { .nhcc-form { flex-direction: column; } .nhcc-votes li { grid-template-columns: 1fr; } }
        @media (max-width: 560px) { .nhcc-impact-grid { grid-template-columns: 1fr; } }
      </style>
      <section class="nhcc-widget">
        <h2>Find your districts and state legislators</h2>
        <p class="nhcc-intro">Enter your full address to see your New Hampshire State Senator and House Representatives, then jump straight to their voting record.</p>
        <form class="nhcc-form">
          <input name="address" autocomplete="street-address" placeholder="Enter your NH address" required>
          <button type="submit">\${escapeHtml(config.buttonText)}</button>
        </form>
        <p class="nhcc-status" data-status></p>
        <div class="nhcc-summary" data-summary></div>
        <div data-divisions></div>
        <div class="nhcc-rep-tool" data-rep-tool hidden>
          <h2>\${escapeHtml(config.title)}</h2>
          <p class="nhcc-intro">Select a legislator to see key votes. Tap any bill card to expand details.</p>
          <div class="nhcc-controls">
            <div class="nhcc-control nhcc-control--highlight">
              <label>Filter by issue</label>
              <select data-issue-filter><option value="">All issues</option></select>
              <div class="nhcc-hint">Tip: pick an issue first to quickly scan the votes that matter to you.</div>
            </div>
            <div class="nhcc-control">
              <label>Legislator</label>
              <select data-rep-select><option value="">Search or select a name</option></select>
            </div>
          </div>
          <div class="nhcc-rep-card nhcc-rep-card--empty" data-rep-card>
            <p>Select a legislator to view their voting record.</p>
          </div>
        </div>
      </section>\`;

    const form = root.querySelector("form");
    const status = root.querySelector("[data-status]");
    const button = root.querySelector("button");
    const repSelect = root.querySelector("[data-rep-select]");
    const issueFilter = root.querySelector("[data-issue-filter]");

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const address = new FormData(form).get("address");
      button.disabled = true;
      status.textContent = "Looking up voting records...";
      try {
        const response = await fetch(config.apiBase.replace(/\\/$/, "") + "/widgets/voting-info/lookup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            address,
            partner: config.partner,
            billTrackerUrl: config.trackerUrl,
            embedderUrl: document.referrer || window.location.href
          })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Lookup failed.");
        status.textContent = "";
        renderResults(root, data);
      } catch (error) {
        status.textContent = error.message || "Unable to load voting records.";
      } finally {
        button.disabled = false;
      }
    });

    repSelect.addEventListener("change", () => renderRepCard(root, repSelect.value));
    issueFilter.addEventListener("change", () => renderRepCard(root, repSelect.value));

    root.addEventListener("click", (event) => {
      const repPill = event.target.closest?.("[data-rep-index]");
      if (repPill) {
        repSelect.value = repPill.dataset.repIndex;
        renderRepCard(root, repPill.dataset.repIndex);
        root.querySelector("[data-rep-tool]")?.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }

      const billButton = event.target.closest?.("[data-bill-code]");
      if (billButton) {
        openBillDialog(
          root,
          billButton.dataset.billCode,
          billButton.dataset.voteImpact || "",
          billButton.dataset.voteLabel || ""
        );
        return;
      }

      if (event.target.closest?.("[data-dialog-close]") || event.target.dataset?.dialogBackdrop !== undefined) {
        closeBillDialog(root);
      }
    });

    root.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeBillDialog(root);
    });
  }

  function mountAll() {
    ensureContainer();
    document.querySelectorAll("[data-nhcc-voting-widget]:not(script)").forEach(mount);
  }

  function observeMounts() {
    if (!document.body || !window.MutationObserver) return;

    const observer = new MutationObserver(() => mountAll());
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      mountAll();
      observeMounts();
    });
  } else {
    mountAll();
    observeMounts();
  }
})();`);
}

async function handleVotingWidgetLookup(request, env) {
  try {
    if (request.method !== "POST") {
      return json({ error: "Method not allowed. Use POST." }, 405);
    }

    const body = await request.json();
    const address = String(body.address || "").trim();
    const partner = await resolvePartnerConfig(env, body.partner, true);
    const requestedBillTrackerUrl = String(body.billTrackerUrl || "").trim();

    if (!address) {
      return json({ error: "Address is required." }, 400);
    }

    const trackerUrl = resolveWidgetTrackerUrl(
      partner,
      requestedBillTrackerUrl || DEFAULT_BILL_TRACKER_URL
    );
    validatePartnerWidgetAccess(request, partner, body.embedderUrl);

    const [lookupResponse, bills] = await Promise.all([
      handleAddressLookup(
        new Request(request.url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ address }),
        }),
        env
      ),
      fetchBillTracker(trackerUrl),
    ]);

    const lookup = await lookupResponse.json();

    if (!lookupResponse.ok) {
      return json(lookup, lookupResponse.status);
    }

    const representatives = await attachTrackedBillVotes(
      env,
      lookup.representatives || [],
      bills
    );
    const votedBillKeys = new Set(
      representatives.flatMap((rep) =>
        (rep.trackedVotes || []).map((item) => getTrackedVoteKey(item.bill))
      )
    );
    const visibleBills = bills.filter((bill) =>
      votedBillKeys.has(getTrackedVoteKey(bill))
    );

    return json({
      address,
      normalizedInput: lookup.normalizedInput || null,
      representatives,
      groups: {
        senate: representatives.filter((rep) => rep.chamber === "Senate"),
        house: representatives.filter((rep) => rep.chamber === "House"),
      },
      bills: visibleBills,
      meta: {
        partner: partner?.id || null,
        billTrackerUrl: trackerUrl,
        billCount: visibleBills.length,
        trackerBillCount: bills.length,
      },
    });
  } catch (error) {
    const message = error.message || "Unable to load voting information.";
    const status =
      message === "Widget partner is required." ||
      message === "Unknown widget partner." ||
      message === "Widget partner registration is incomplete." ||
      message === "This partner is not allowed to use that bill tracker."
        ? 400
        : message === "Widget partner is not active." ||
            message === "This widget partner is not allowed on this site."
          ? 403
          : 500;

    return json(
      {
        error: message,
      },
      status
    );
  }
}

async function resolvePartnerConfig(env, value, required = false) {
  const partnerId = String(value || "").trim().toLowerCase();
  if (!partnerId) {
    if (required) throw new Error("Widget partner is required.");
    return null;
  }

  if (!env.CIVIC_COMMONS_DB) {
    throw new Error("Widget partner registry is not configured.");
  }

  const result = await env.CIVIC_COMMONS_DB.prepare(`
    SELECT
      partner_id,
      name,
      allowed_origins,
      allowed_tracker_urls,
      active
    FROM widget_partners
    WHERE lower(partner_id) = ?
    LIMIT 1
  `)
    .bind(partnerId)
    .first();

  if (!result) {
    throw new Error("Unknown widget partner.");
  }

  if (Number(result.active) !== 1) {
    throw new Error("Widget partner is not active.");
  }

  const allowedOrigins = parseJsonStringList(result.allowed_origins);
  const allowedTrackerUrls = parseJsonStringList(result.allowed_tracker_urls)
    .map((trackerUrl) => validateBillTrackerUrl(trackerUrl));

  if (!allowedOrigins.length || !allowedTrackerUrls.length) {
    throw new Error("Widget partner registration is incomplete.");
  }

  return {
    id: result.partner_id,
    name: result.name,
    allowedOrigins,
    allowedTrackerUrls,
  };
}

function resolveWidgetTrackerUrl(partner, requestedBillTrackerUrl) {
  const defaultTrackerUrl = partner?.allowedTrackerUrls?.[0] || requestedBillTrackerUrl;
  const trackerUrl = validateBillTrackerUrl(defaultTrackerUrl);

  if (!partner) return trackerUrl;

  const requestedUrl = requestedBillTrackerUrl
    ? validateBillTrackerUrl(requestedBillTrackerUrl)
    : "";

  if (
    requestedUrl &&
    requestedUrl !== DEFAULT_BILL_TRACKER_URL &&
    !partner.allowedTrackerUrls.includes(requestedUrl)
  ) {
    throw new Error("This partner is not allowed to use that bill tracker.");
  }

  return requestedUrl && requestedUrl !== DEFAULT_BILL_TRACKER_URL
    ? requestedUrl
    : trackerUrl;
}

function validatePartnerWidgetAccess(request, partner, embedderUrl) {
  if (!partner) return;

  const candidates = [
    request.headers.get("origin"),
    request.headers.get("referer"),
    embedderUrl,
  ];

  if (candidates.some((candidate) => isAllowedPartnerUrl(candidate, partner))) {
    return;
  }

  throw new Error("This widget partner is not allowed on this site.");
}

function isAllowedPartnerUrl(value, partner) {
  if (!value) return false;

  try {
    const origin = new URL(value).origin.toLowerCase();
    return partner.allowedOrigins.includes(origin);
  } catch {
    return false;
  }
}

function parseJsonStringList(value) {
  try {
    const list = JSON.parse(String(value || "[]"));
    if (!Array.isArray(list)) return [];

    return list
      .map((item) => String(item || "").trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function validateBillTrackerUrl(value) {
  const url = new URL(value);

  if (!["https:", "http:"].includes(url.protocol)) {
    throw new Error("billTrackerUrl must be an http(s) URL.");
  }

  return url.toString();
}

async function fetchBillTracker(url) {
  const response = await fetch(url, {
    headers: { Accept: "text/csv,text/plain,*/*" },
  });

  if (!response.ok) {
    throw new Error("Unable to fetch bill tracker CSV.");
  }

  return parseBillTrackerCsv(await response.text());
}

function parseBillTrackerCsv(csvText) {
  const rows = parseCsv(csvText);
  const headers = rows.shift() || [];

  return rows
    .map((row) => {
      const record = Object.fromEntries(
        headers.map((header, index) => [
          header.trim().replace(/^\uFEFF/, ""),
          row[index] || "",
        ])
      );
      const code = normalizeBillNumber(record.Code);

      if (!code) return null;

      return {
        code,
        name: record.Name || code,
        summary: record.Summary || "",
        impact: record.Impact || "",
        moreInfoUrl: record.MoreInfoURL || "",
        issueArea: record["Issue Area"] || "",
        articles: record.Articles || "",
        preferredStance: normalizePreferredStance(
          getRecordValue(record, [
            "Preferred Stance",
            "PreferredStance",
            "Preferred Vote",
            "PreferredVote",
          ])
        ),
        yeaInterpretation: record["Yea Interpretation"] || "",
        nayInterpretation: record["Nay Interpretation"] || "",
        yeaImpact: record["Yea Impact"] || "",
        nayImpact: record["Nay Impact"] || "",
        testimonySupporting: record["Testimony Supporting"] || "",
        testimonyOpposed: record["Testimony Opposed"] || "",
        voteSequence: normalizeVoteSequence(
          getRecordValue(record, [
            "Vote Sequence",
            "VoteSequence",
            "Vote Sequence Number",
            "VoteSequenceNumber",
            "Vote Seq",
            "VoteSeq",
          ])
        ),
      };
    })
    .filter(Boolean);
}

function getRecordValue(record, names) {
  for (const name of names) {
    if (record[name] !== undefined) return record[name];
  }

  const normalizedNames = new Set(
    names.map((name) => name.toLowerCase().replace(/[^a-z0-9]/g, ""))
  );
  const entry = Object.entries(record).find(([key]) =>
    normalizedNames.has(key.toLowerCase().replace(/[^a-z0-9]/g, ""))
  );
  return entry ? entry[1] : "";
}

function normalizeVoteSequence(value) {
  const text = String(value || "").trim();
  if (!text) return "";

  const number = Number(text);
  return Number.isFinite(number) ? String(Math.trunc(number)) : text;
}

function normalizePreferredStance(value) {
  const text = String(value || "").trim().toLowerCase();
  if (["yea", "yes", "y"].includes(text)) return "yea";
  if (["nay", "no", "n"].includes(text)) return "nay";
  return "";
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }

  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

async function attachTrackedBillVotes(env, representatives, bills) {
  const billCodes = bills.map((bill) => bill.code).filter(Boolean);
  const employeenos = representatives
    .map((rep) => rep.employeeno)
    .filter(Boolean);

  if (!billCodes.length || !employeenos.length) {
    return representatives.map((rep) => ({
      ...rep,
      trackedVotes: [],
    }));
  }

  const votes = await getTrackedVotes(env, employeenos, bills);

  return representatives.map((rep) => {
    const repVotes = votes.get(String(rep.employeeno)) || new Map();

    return {
      ...rep,
      trackedVotes: bills
        .map((bill) => {
          const vote = repVotes.get(getTrackedVoteKey(bill)) || null;
          if (!vote) return null;

          return {
            bill,
            vote,
            interpretation: getVoteInterpretation(bill, vote),
            voteImpact: getVoteImpact(bill, vote),
          };
        })
        .filter(Boolean),
    };
  });
}

function getTrackedVoteKey(bill) {
  return bill.voteSequence ? `sequence:${bill.voteSequence}` : `bill:${bill.code}`;
}

function getVoteInterpretation(bill, vote) {
  if (!vote) return "";

  if (vote.vote === "yea") {
    return bill.yeaInterpretation || "";
  }

  if (vote.vote === "nay") {
    return bill.nayInterpretation || "";
  }

  return "";
}

function getVoteImpact(bill, vote) {
  if (!vote) return "";

  if (vote.vote === "yea") {
    return bill.yeaImpact || "";
  }

  if (vote.vote === "nay") {
    return bill.nayImpact || "";
  }

  return "";
}

async function getTrackedVotes(env, employeenos, bills) {
  const billCodes = bills.map((bill) => bill.code).filter(Boolean);
  const voteSequences = bills
    .map((bill) => bill.voteSequence)
    .filter(Boolean);
  const voteSequenceSet = new Set(voteSequences);
  const whereParts = [];
  const binds = [...employeenos];

  if (billCodes.length) {
    whereParts.push(`UPPER(h.condensedbillno) IN (${billCodes.map(() => "?").join(", ")})`);
    binds.push(...billCodes);
  }

  if (voteSequences.length) {
    whereParts.push(`CAST(h.votesequencenumber AS TEXT) IN (${voteSequences.map(() => "?").join(", ")})`);
    binds.push(...voteSequences);
  }

  const result = await env.DB.prepare(`
    SELECT
      h.employeenumber,
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
      rs.question_motion
    FROM d1_rollcallhistory h
    LEFT JOIN d1_rollcallsummary rs
      ON rs.sessionyear = h.sessionyear
      AND rs.legislativebody = h.legislativebody
      AND rs.votesequencenumber = h.votesequencenumber
    WHERE h.employeenumber IN (${employeenos.map(() => "?").join(", ")})
      AND (${whereParts.join(" OR ")})
    ORDER BY h.sessionyear DESC, h.votesequencenumber DESC
  `)
    .bind(...binds)
    .all();

  const votes = new Map();

  for (const vote of result.results || []) {
    const repKey = String(vote.employeenumber);
    const billKey = normalizeBillNumber(vote.condensedbillno);
    const sequenceKey = normalizeVoteSequence(vote.votesequencenumber);
    const voteKey = voteSequenceSet.has(sequenceKey)
      ? `sequence:${sequenceKey}`
      : `bill:${billKey}`;

    if (!votes.has(repKey)) votes.set(repKey, new Map());
    if (!votes.get(repKey).has(voteKey)) votes.get(repKey).set(voteKey, vote);
  }

  return votes;
}


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
      ${isFreeStaterSelectExpression("l.is_free_stater")},
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
    community: await buildCommunityResponse(env, district, articleLimit, {
      includeSenators: kind === "house",
    }),
    meta: {
      articleLimit,
    },
  });
}

async function handleCommunityCounty(request, env) {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  const countySlug = decodeURIComponent(parts[2] || "");

  if (!countySlug) {
    return json({ error: "Use /communities/counties/{county}." }, 400);
  }

  const county = await getCountyBySlug(env, countySlug);

  if (!county) {
    return json({ error: "County not found." }, 404);
  }

  const districts = await getHouseDistrictsForCounty(env, county);
  const representativeCounts = await getHouseRepresentativeCountsForCounty(
    env,
    county.source_county_id
  );
  const towns = new Set();

  for (const district of districts) {
    for (const town of splitCommunityList(
      district.towns_represented || district.communities_represented
    )) {
      const townName = getCountyTownName(town);

      if (townName) {
        towns.add(townName);
      }
    }
  }

  const totalHouseCounties = await env.DB.prepare(`
    SELECT COUNT(DISTINCT LOWER(d.county)) AS total
    FROM divisions d
    WHERE d.type = 'house_district'
      AND COALESCE(d.county, '') != ''
  `).first();

  return json({
    counties: [
      {
        name: county.name,
        slug: slugifyPathPart(county.name),
        districtCount: districts.length,
        townsRepresented: [...towns].sort((a, b) => a.localeCompare(b)),
        representativeCount: [...representativeCounts.values()].reduce(
          (total, count) => total + count,
          0
        ),
        districts: districts.map((district) => ({
          name: `${county.name} ${district.district_number}`,
          body: "H",
          county: county.name,
          district: district.district_number,
          path: `/communities/house/${slugifyPathPart(county.name)}/${
            district.district_number
          }`,
        })),
        relatedArticles: [],
      },
    ],
    meta: {
      total: totalHouseCounties?.total || 0,
      body: "house",
    },
  });
}

async function handleCommunityTown(request, env) {
  const url = new URL(request.url);
  const parts = url.pathname.split("/").filter(Boolean);
  const townSlug = decodeURIComponent(parts[2] || "");
  const articleLimit = boundedNumber(
    url.searchParams.get("articleLimit"),
    5,
    0,
    25
  );
  const voteLimit = boundedNumber(url.searchParams.get("voteLimit"), 0, 0, 100);
  const candidateYear = boundedNumber(
    url.searchParams.get("candidateYear"),
    2026,
    2000,
    2100
  );

  if (!townSlug) {
    return json({ error: "Use /communities/towns/{town}." }, 400);
  }

  const townName = titleizeCommunityName(townSlug);
  const districts = await findTownDistricts(env, townName);

  if (!districts.length) {
    return json({ error: "Town not found." }, 404);
  }

  const houseDistricts = districts.filter((district) => district.body === "H");
  const senateDistricts = districts.filter((district) => district.body === "S");
  const representatives = await attachVoteHistory(
    env,
    [
      ...(await findSenatorsForDistricts(env, senateDistricts)),
      ...(await findHouseRepsFromDistrictMappings(env, houseDistricts)),
    ],
    voteLimit
  );
  const candidates = await getCandidatesForDistrictMappings(
    env,
    districts,
    candidateYear
  );
  const relatedArticles = await getArticlesForTownPreview(
    env,
    townName,
    representatives,
    articleLimit
  );

  return json({
    town: {
      name: townName,
      slug: slugifyPathPart(townName),
    },
    districts: districts.map(formatTownDistrict),
    representativeSummary: {
      count: representatives.length,
      names: representatives.map((rep) => rep.name),
      parties: summarizeParties(representatives),
    },
    representatives,
    candidates,
    groups: {
      senate: {
        districts: senateDistricts.map(formatTownDistrict),
        representatives: representatives.filter((rep) => rep.chamber === "Senate"),
        candidates: candidates.filter((candidate) => candidate.office === "State Senate"),
      },
      house: {
        districts: houseDistricts.map(formatTownDistrict),
        representatives: representatives.filter((rep) => rep.chamber === "House"),
        candidates: candidates.filter((candidate) => candidate.office === "State Representative"),
      },
    },
    relatedArticles,
    meta: {
      articleLimit,
      voteLimit,
      candidateYear,
    },
  });
}

async function getCountyBySlug(env, countySlug) {
  const normalizedCounty = normalizeCommunityPathPart(countySlug);
  const numericCounty = Number(normalizedCounty);

  return env.DB.prepare(`
    SELECT
      name,
      code,
      source_county_id
    FROM county_codes
    WHERE LOWER(name) = ?
      OR LOWER(REPLACE(name, ' ', '-')) = ?
      OR LOWER(code) = ?
      OR source_county_id = ?
    LIMIT 1
  `)
    .bind(
      normalizedCounty.replace(/-/g, " "),
      normalizedCounty,
      normalizedCounty,
      Number.isFinite(numericCounty) ? numericCounty : -1
    )
    .first();
}

async function getHouseDistrictsForCounty(env, county) {
  const result = await env.DB.prepare(`
    SELECT
      d.id,
      d.name,
      d.slug,
      d.type,
      'House' AS chamber,
      'H' AS body,
      cc.source_county_id AS county_number,
      d.county,
      d.district AS district_number,
      COALESCE(dm.district_label, d.name) AS district_label,
      COALESCE(dm.communities_represented, d.towns_represented, '') AS communities_represented,
      d.towns_represented,
      d.floterial,
      d.seats
    FROM divisions d
    LEFT JOIN county_codes cc
      ON LOWER(cc.name) = LOWER(d.county)
    LEFT JOIN d1_district_mapping dm
      ON dm.body = 'H'
      AND dm.county = cc.source_county_id
      AND dm.district = d.district
    WHERE d.type = 'house_district'
      AND cc.source_county_id = ?
    ORDER BY d.district, d.name
  `)
    .bind(county.source_county_id)
    .all();

  return result.results || [];
}

async function getHouseRepresentativeCountsForCounty(env, countyNumber) {
  const result = await env.DB.prepare(`
    SELECT
      CAST(l.district AS INTEGER) AS district_number,
      COUNT(*) AS representative_count
    FROM d1_legislators l
    WHERE l.active = 1
      AND l.legislativebody = 'H'
      AND CAST(l.countycode AS INTEGER) = ?
    GROUP BY CAST(l.district AS INTEGER)
  `)
    .bind(countyNumber)
    .all();

  return new Map(
    (result.results || []).map((row) => [
      row.district_number,
      row.representative_count,
    ])
  );
}

async function findTownDistricts(env, townName) {
  const normalizedTown = normalizeCommunityText(townName);

  if (!normalizedTown) return [];

  const searchPatterns = getTownSearchPatterns(normalizedTown);
  const result = await env.DB.prepare(`
    SELECT DISTINCT
      dm.body,
      dm.county,
      cc.name AS county_name,
      dm.district,
      dm.district_label,
      dm.communities_represented
    FROM d1_district_mapping dm
    LEFT JOIN county_codes cc
      ON cc.source_county_id = dm.county
    WHERE ${searchPatterns
      .map(() => "LOWER(dm.communities_represented) LIKE LOWER(?)")
      .join(" OR ")}
    ORDER BY
      CASE dm.body
        WHEN 'S' THEN 1
        WHEN 'H' THEN 2
        ELSE 3
      END,
      dm.county,
      dm.district
  `)
    .bind(...searchPatterns)
    .all();

  const seen = new Set();

  return (result.results || []).filter((district) => {
    if (!townDistrictMatches(district.communities_represented, normalizedTown)) {
      return false;
    }

    const key = `${district.body}_${district.county}_${district.district}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getTownSearchPatterns(normalizedTown) {
  const patterns = [`%${normalizedTown}%`];

  if (normalizedTown === "manchester") {
    patterns.push("%mancheseter%");
  }

  return patterns;
}

function townDistrictMatches(communities, normalizedTown) {
  return splitCommunityList(communities).some((community) => {
    const normalizedCommunity = normalizeCommunityText(
      getCountyTownName(community)
    );

    return normalizedCommunity === normalizedTown;
  });
}

function districtCommunitiesOverlap(houseCommunities, senateCommunities) {
  return houseCommunities.some((houseCommunity) =>
    senateCommunities.some((senateCommunity) =>
      senateCommunityCoversHouseCommunity(senateCommunity, houseCommunity)
    )
  );
}

function senateCommunityCoversHouseCommunity(senateCommunity, houseCommunity) {
  const senateTown = normalizeCommunityText(getCountyTownName(senateCommunity));
  const houseTown = normalizeCommunityText(getCountyTownName(houseCommunity));

  if (!senateTown || senateTown !== houseTown) return false;

  const senateWards = getCommunityWardNumbers(senateCommunity);
  const houseWards = getCommunityWardNumbers(houseCommunity);

  if (!houseWards.length || !senateWards.length) return true;

  return houseWards.every((ward) => senateWards.includes(ward));
}

function getCommunityWardNumbers(value) {
  const normalized = String(value || "")
    .replace(/^Mancheseter\b/i, "Manchester")
    .replace(/-/g, " ")
    .toLowerCase();
  const wardMatch = normalized.match(/\bwards?\s+(.+)$/i);

  if (!wardMatch) return [];

  return wardMatch[1]
    .match(/\d+/g)
    ?.map((ward) => Number(ward))
    .filter((ward) => Number.isInteger(ward)) || [];
}

function formatTownDistrict(district) {
  return {
    name:
      district.body === "S"
        ? `Senate ${district.district}`
        : `${district.county_name || countyCodeFromNumber(district.county)} ${
            district.district
          }`,
    body: district.body,
    chamber: district.body === "S" ? "Senate" : "House",
    county: district.county_name || null,
    countyNumber: district.county || null,
    district: district.district,
    label: district.district_label,
    path:
      district.body === "S"
        ? `/communities/senate/${district.district}`
        : `/communities/house/${slugifyPathPart(
            district.county_name || countyCodeFromNumber(district.county)
          )}/${district.district}`,
  };
}

async function findSenatorsForDistricts(env, districts) {
  const reps = [];

  for (const district of districts || []) {
    reps.push(...(await findSenators(env, { district: district.district })));
  }

  return dedupeReps(reps);
}

async function getCandidatesForDistrictMappings(env, districts, electionYear) {
  const conditions = [];
  const binds = [];

  for (const district of districts || []) {
    if (district.body === "S") {
      conditions.push(`
        (
          c.office = 'State Senate'
          AND c.district = ?
        )
      `);
      binds.push(String(district.district));
    }

    if (district.body === "H") {
      conditions.push(`
        (
          c.office = 'State Representative'
          AND cc.source_county_id = ?
          AND c.district = ?
        )
      `);
      binds.push(district.county, String(district.district));
    }
  }

  if (!conditions.length) return [];

  const result = await env.DB.prepare(`
    SELECT DISTINCT ${candidateSelectColumns("c")}
    FROM candidates c
    LEFT JOIN county_codes cc
      ON LOWER(cc.name) = LOWER(c.county)
    WHERE c.election_year = ?
      AND (${conditions.map((condition) => `(${condition})`).join(" OR ")})
    ORDER BY
      c.office,
      c.county,
      CAST(COALESCE(c.district, '0') AS INTEGER),
      c.candidate_last_name,
      c.candidate_first_name
  `)
    .bind(electionYear, ...binds)
    .all();

  return (result.results || []).map(formatCandidate);
}

async function getArticlesForTownPreview(env, townName, representatives, limit) {
  if (!limit) return [];

  const normalizedTown = normalizeCommunityText(townName);
  const personids = representatives
    .map((rep) => rep.personid || rep.id)
    .filter(Boolean);
  const employeenos = representatives
    .map((rep) => rep.employeeno)
    .filter(Boolean);
  const conditions = [`LOWER(at.town) = ?`];
  const binds = [normalizedTown];

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

async function buildCommunityResponse(env, district, articleLimit, options = {}) {
  const representatives = await getRepresentativesForDistrict(env, district);
  const senators =
    options.includeSenators && district.body === "H"
      ? await getSenatorsForHouseDistrict(env, district)
      : [];
  const relatedArticles = await getArticlesForCommunityPreview(
    env,
    district,
    representatives,
    articleLimit
  );

  const response = {
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

  if (options.includeSenators && district.body === "H") {
    response.senators = senators;
    response.senatorSummary = {
      count: senators.length,
      names: senators.map((senator) => senator.name),
      parties: summarizeParties(senators),
    };
  }

  return response;
}

async function getSenatorsForHouseDistrict(env, district) {
  const houseCommunities = splitDistrictCommunities(
    district.towns_represented || district.communities_represented
  );

  if (!houseCommunities.length) return [];

  const result = await env.DB.prepare(`
    SELECT
      dm.body,
      dm.county,
      NULL AS county_name,
      dm.district,
      dm.district_label,
      dm.communities_represented
    FROM d1_district_mapping dm
    WHERE dm.body = 'S'
    ORDER BY dm.district
  `).all();

  const senateDistricts = (result.results || []).filter((senateDistrict) =>
    districtCommunitiesOverlap(
      houseCommunities,
      splitDistrictCommunities(senateDistrict.communities_represented)
    )
  );

  return findSenatorsForDistricts(env, senateDistricts);
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
      ${isFreeStaterSelectExpression("l.is_free_stater")},
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

function splitDistrictCommunities(value) {
  return String(value || "")
    .split(/;/)
    .flatMap((part) => {
      const trimmed = part.trim();

      if (/\bwards?\s+\d+(?:\s*,\s*\d+)+/i.test(trimmed)) {
        return [trimmed];
      }

      return trimmed.split(",");
    })
    .map((item) => item.trim())
    .filter(Boolean);
}

function getCountyTownName(value) {
  const town = String(value || "")
    .trim()
    .replace(/^Mancheseter\b/i, "Manchester")
    .replace(/[-\s]+wards?\s+\d+.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();

  return /^\d+$/.test(town) ? "" : town;
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

function isFreeStaterSelectExpression(column) {
  return `
    CASE
      WHEN LOWER(CAST(COALESCE(${column}, '') AS TEXT)) IN ('1', 'true', 'yes', 'y')
      THEN 'yes'
      ELSE 'no'
    END AS is_free_stater
  `;
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

function slugifyPathPart(value) {
  return normalizeCommunityPathPart(value);
}

function titleizeCommunityName(value) {
  return String(value || "")
    .trim()
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

async function handleCandidates(request, env) {
  const url = new URL(request.url);
  const q = String(url.searchParams.get("q") || "").trim();
  const officeType = String(url.searchParams.get("officeType") || "").trim();
  const office = String(url.searchParams.get("office") || "").trim();
  const county = String(url.searchParams.get("county") || "").trim();
  const district = String(url.searchParams.get("district") || "").trim();
  const party = String(url.searchParams.get("party") || "").trim();
  const electionYear = url.searchParams.get("electionYear");
  const limit = boundedNumber(url.searchParams.get("limit"), 50, 1, 100);
  const offset = boundedNumber(url.searchParams.get("offset"), 0, 0, 10000);

  const where = ["1 = 1"];
  const binds = [];

  if (q) {
    const search = `%${q}%`;
    where.push(`
      (
        candidate_first_name LIKE ?
        OR candidate_last_name LIKE ?
        OR candidate_first_name || ' ' || candidate_last_name LIKE ?
        OR slug LIKE ?
        OR office LIKE ?
        OR county LIKE ?
      )
    `);
    binds.push(search, search, search, search, search, search);
  }

  if (officeType) {
    where.push(`LOWER(office_type) = LOWER(?)`);
    binds.push(officeType);
  }

  if (office) {
    where.push(`LOWER(office) = LOWER(?)`);
    binds.push(office);
  }

  if (county) {
    where.push(`LOWER(county) = LOWER(?)`);
    binds.push(county);
  }

  if (district) {
    where.push(`district = ?`);
    binds.push(district);
  }

  if (party) {
    where.push(`LOWER(political_party) = LOWER(?)`);
    binds.push(party);
  }

  if (electionYear) {
    const year = Number(electionYear);
    if (!Number.isInteger(year)) {
      return json({ error: "electionYear must be a number." }, 400);
    }
    where.push(`election_year = ?`);
    binds.push(year);
  }

  const result = await env.DB.prepare(`
    SELECT ${candidateSelectColumns()}
    FROM candidates
    WHERE ${where.join(" AND ")}
    ORDER BY
      election_year DESC,
      office_type,
      office,
      county,
      CAST(COALESCE(district, '0') AS INTEGER),
      candidate_last_name,
      candidate_first_name
    LIMIT ?
    OFFSET ?
  `)
    .bind(...binds, limit, offset)
    .all();

  return json({
    candidates: (result.results || []).map(formatCandidate),
    meta: {
      q,
      officeType,
      office,
      county,
      district,
      party,
      electionYear: electionYear ? Number(electionYear) : null,
      limit,
      offset,
      count: result.results?.length || 0,
    },
  });
}

async function handleCandidateDetail(request, env) {
  const url = new URL(request.url);
  const identifier = decodeURIComponent(
    url.pathname.split("/").filter(Boolean)[1] || ""
  );

  if (!identifier) {
    return json({ error: "Candidate identifier is required." }, 400);
  }

  const candidate = await env.DB.prepare(`
    SELECT ${candidateSelectColumns()}
    FROM candidates
    WHERE filer_entity_number = ?
      OR slug = ?
    LIMIT 1
  `)
    .bind(identifier, identifier)
    .first();

  if (!candidate) {
    return json({ error: "Candidate not found." }, 404);
  }

  return json({
    candidate: formatCandidate(candidate),
  });
}

async function getCandidatesForAddressDistricts(
  env,
  parsed,
  houseDistricts,
  electionYear
) {
  const conditions = [];
  const binds = [];

  if (parsed.senate?.district) {
    conditions.push(`
      (
        c.office = 'State Senate'
        AND c.district = ?
      )
    `);
    binds.push(String(parsed.senate.district));
  }

  for (const district of houseDistricts || []) {
    if (!district.county || !district.district) continue;

    conditions.push(`
      (
        c.office = 'State Representative'
        AND cc.source_county_id = ?
        AND c.district = ?
      )
    `);
    binds.push(district.county, String(district.district));
  }

  if (!conditions.length) return [];

  const result = await env.DB.prepare(`
    SELECT DISTINCT ${candidateSelectColumns("c")}
    FROM candidates c
    LEFT JOIN county_codes cc
      ON LOWER(cc.name) = LOWER(c.county)
    WHERE c.election_year = ?
      AND (${conditions.map((condition) => `(${condition})`).join(" OR ")})
    ORDER BY
      c.office,
      c.county,
      CAST(COALESCE(c.district, '0') AS INTEGER),
      c.candidate_last_name,
      c.candidate_first_name
  `)
    .bind(electionYear, ...binds)
    .all();

  return (result.results || []).map(formatCandidate);
}

function candidateSelectColumns(tableAlias = "") {
  const prefix = tableAlias ? `${tableAlias}.` : "";
  return [
    "filer_entity_number",
    "candidate_first_name",
    "candidate_last_name",
    "office_type",
    "office",
    "county",
    "district",
    "political_party",
    "election_year",
    "election_cycle",
    "total_raised",
    "total_spent",
    "candidate_website",
    "candidate_email",
    "photo_url",
    "slug",
    isFreeStaterSelectExpression(`${prefix}is_free_stater`),
  ]
    .map((column) =>
      column.includes(" AS ") ? column : `${prefix}${column}`
    )
    .join(", ");
}

function formatCandidate(candidate) {
  return {
    filerEntityNumber: candidate.filer_entity_number,
    candidateFirstName: candidate.candidate_first_name,
    candidateLastName: candidate.candidate_last_name,
    name: [candidate.candidate_first_name, candidate.candidate_last_name]
      .filter(Boolean)
      .join(" "),
    officeType: candidate.office_type,
    office: candidate.office,
    county: candidate.county,
    district: candidate.district,
    politicalParty: candidate.political_party,
    electionYear: candidate.election_year,
    electionCycle: candidate.election_cycle,
    totalRaised: candidate.total_raised,
    totalSpent: candidate.total_spent,
    candidateWebsite: candidate.candidate_website,
    candidateEmail: candidate.candidate_email,
    photoUrl: candidate.photo_url,
    slug: candidate.slug,
    is_free_stater: candidate.is_free_stater || "no",
    isFreeStater: candidate.is_free_stater || "no",
  };
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
      ${isFreeStaterSelectExpression("r.is_free_stater")},
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
    const candidateYear = boundedNumber(
      url.searchParams.get("candidateYear"),
      2026,
      2000,
      2100
    );

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

    const candidates = await getCandidatesForAddressDistricts(
      env,
      parsed,
      houseDistricts,
      candidateYear
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
      candidates,
      groups: {
        senate: representatives.filter((r) => r.chamber === "Senate"),
        house: representatives.filter((r) => r.chamber === "House"),
        candidates: {
          senate: candidates.filter((candidate) => candidate.office === "State Senate"),
          house: candidates.filter((candidate) => candidate.office === "State Representative"),
        },
      },
      meta: {
        voteLimit,
        candidateYear,
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
        ${isFreeStaterSelectExpression("l.is_free_stater")},
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
      ${isFreeStaterSelectExpression("l.is_free_stater")},
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
  if (!limit) {
    return (reps || []).map((rep) => ({
      ...rep,
      voteHistory: [],
    }));
  }

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
      ${isFreeStaterSelectExpression("is_free_stater")},
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
