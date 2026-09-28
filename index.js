#!/usr/bin/env node
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer, acceptedContent, inputRequired } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";

const DATA_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "data", "session.json");
const API_PREFIX = "/k/default";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
const SUBDOMAIN_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const CURL_REQUEST = {
  message:
    "Paste a curl command copied from a signed-in Keka request. In DevTools, open Network, right-click a /k/default/api/me/ call, and choose Copy as cURL.",
  requestedSchema: {
    type: "object",
    properties: {
      curl: {
        type: "string",
        title: "Curl",
        description: "The full curl command from a signed-in /k/default/api/me/ request.",
      },
    },
    required: ["curl"],
  },
};

class KekaSessionError extends Error {
  constructor(message) {
    super(message);
    this.name = "KekaSessionError";
  }
}

let session = null;
let saveQueue = Promise.resolve();

function todayLocal() {
  return formatLocal(new Date());
}

function formatLocal(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function shiftIsoDate(isoDate, days) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);
  return formatLocal(date);
}

function normalizeCookie(value) {
  let cookie = value.trim();
  if (/^cookie\s*:/i.test(cookie)) cookie = cookie.replace(/^cookie\s*:/i, "").trim();
  return cookie;
}

function normalizeBearer(value) {
  let token = value.trim();
  if (/^authorization\s*:/i.test(token)) token = token.replace(/^authorization\s*:/i, "").trim();
  if (/^bearer\s+/i.test(token)) token = token.replace(/^bearer\s+/i, "").trim();
  return token;
}

function shellTokens(input) {
  const tokens = [];
  let current = "";
  let quote = "";
  const text = input.replace(/\\\r?\n/g, " ");
  for (const char of text) {
    if (quote) {
      if (char === quote) quote = "";
      else current += char;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) tokens.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (current) tokens.push(current);
  return tokens;
}

function splitHeader(value) {
  const match = String(value).match(/^([^:]+):\s*([\s\S]*)$/);
  if (!match) return { name: "", value: "" };
  return { name: match[1].trim().toLowerCase(), value: match[2].trim() };
}

function parseCurl(raw) {
  const tokens = shellTokens(raw);
  const headers = [];
  let url = "";
  let cookie = "";
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const next = tokens[index + 1] ?? "";
    if (token === "--url") {
      url = next;
      index += 1;
    } else if (token === "-b" || token === "--cookie") {
      cookie = next;
      index += 1;
    } else if (token === "-H" || token === "--header") {
      headers.push(splitHeader(next));
      index += 1;
    } else if (token.startsWith("--url=")) url = token.slice("--url=".length);
    else if (token.startsWith("--cookie=")) cookie = token.slice("--cookie=".length);
    else if (token.startsWith("--header=")) headers.push(splitHeader(token.slice("--header=".length)));
    else if (/^https?:\/\//i.test(token)) url = token;
  }

  const authorization = headers.find((header) => header.name === "authorization")?.value ?? "";
  const headerCookie = headers.find((header) => header.name === "cookie")?.value ?? "";
  const bearer = normalizeBearer(authorization);
  const parsedCookie = normalizeCookie(cookie || headerCookie);
  let subdomain = "";
  if (url) {
    try {
      const host = new URL(url).hostname.toLowerCase();
      const match = host.match(/^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.keka\.com$/);
      if (match) subdomain = match[1];
    } catch {
      subdomain = "";
    }
  }

  const problems = [];
  if (!url) problems.push("Paste a curl command copied from a signed-in Keka request.");
  else if (!SUBDOMAIN_PATTERN.test(subdomain)) problems.push("The curl URL must be on https://company.keka.com.");
  if (!bearer) problems.push("The curl needs an Authorization: Bearer header.");
  else if (/\s/.test(bearer) || bearer.split(".").length !== 3) {
    problems.push("The Authorization bearer in the curl is not a token.");
  }
  if (parsedCookie && /[\r\n]/.test(parsedCookie)) problems.push("The cookie in the curl must be a single header value.");
  return { subdomain, cookie: parsedCookie, bearer, problems };
}

function sessionFromSaved(raw) {
  if (raw?.bearer && raw?.subdomain) return { subdomain: raw.subdomain, cookie: raw.cookie ?? "", bearer: raw.bearer };
  const records = raw?.tokens ? Object.values(raw.tokens) : [];
  const record = records.find((item) => item?.bearer) ?? records[0];
  if (!record?.bearer || !record?.subdomain) return null;
  return { subdomain: record.subdomain, cookie: record.cookie ?? "", bearer: record.bearer };
}

async function loadSession() {
  try {
    session = sessionFromSaved(JSON.parse(await readFile(DATA_FILE, "utf8")));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function persistSession() {
  saveQueue = saveQueue.then(async () => {
    await mkdir(path.dirname(DATA_FILE), { recursive: true, mode: 0o700 });
    const temporary = `${DATA_FILE}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(session ?? {}), { mode: 0o600 });
    await chmod(temporary, 0o600);
    await rename(temporary, DATA_FILE);
    await chmod(DATA_FILE, 0o600);
  });
  return saveQueue;
}

async function clearSession() {
  session = null;
  await persistSession();
}

function askForCurl() {
  return inputRequired({ inputRequests: { keka: inputRequired.elicit(CURL_REQUEST) } });
}

function companyLabel(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .split("/")[0]
    .replace(/\.keka\.com$/, "");
}

function credentialsFromEnv() {
  const curl = process.env.KEKA_CURL?.trim();
  if (curl) {
    const parsed = parseCurl(curl);
    if (parsed.problems.length > 0) throw new Error(parsed.problems.join(" "));
    return { subdomain: parsed.subdomain, cookie: parsed.cookie, bearer: parsed.bearer };
  }
  const token = process.env.KEKA_TOKEN || process.env.KEKA_BEARER || "";
  const company = process.env.KEKA_COMPANY || process.env.KEKA_SUBDOMAIN || "";
  if (!token && !company && !process.env.KEKA_COOKIE) return null;
  const bearer = normalizeBearer(token);
  const subdomain = companyLabel(company);
  const problems = [];
  if (!SUBDOMAIN_PATTERN.test(subdomain)) problems.push("KEKA_COMPANY must be the label in https://company.keka.com.");
  if (!bearer || /\s/.test(bearer) || bearer.split(".").length !== 3) {
    problems.push("KEKA_TOKEN must be the Authorization bearer from a signed-in Keka request.");
  }
  if (problems.length > 0) throw new Error(problems.join(" "));
  return { subdomain, cookie: normalizeCookie(process.env.KEKA_COOKIE ?? ""), bearer };
}

function asConfig(record) {
  return { subdomain: record.subdomain, cookie: record.cookie, bearer: record.bearer, origin: `https://${record.subdomain}.keka.com` };
}

async function ensureSession(ctx) {
  const accepted = acceptedContent(ctx?.mcpReq?.inputResponses, "keka");
  if (accepted && typeof accepted.curl === "string") {
    const parsed = parseCurl(accepted.curl);
    if (parsed.problems.length > 0) throw new Error(parsed.problems.join(" "));
    session = { subdomain: parsed.subdomain, cookie: parsed.cookie, bearer: parsed.bearer };
    await persistSession();
    return asConfig(session);
  }
  const fromEnv = credentialsFromEnv();
  if (fromEnv) return asConfig(fromEnv);
  if (session?.bearer) return asConfig(session);
  return askForCurl();
}

function sessionExpiredMessage() {
  return "Keka rejected the access token. Paste a fresh curl, or update KEKA_CURL / KEKA_TOKEN in the MCP config.";
}

function looksLikeLoginPage(body, location) {
  const target = `${location ?? ""} ${body.slice(0, 500)}`.toLowerCase();
  return target.includes("/account/login") || target.includes("login to keka") || target.includes("js-keka-login");
}

async function kekaGet(config, pathname, query) {
  const url = new URL(`${API_PREFIX}${pathname}`, config.origin);
  const params = queryFor(pathname, query);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value != null && value !== "") url.searchParams.set(key, value);
    }
  }
  const headers = {
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "en-IN,en;q=0.9",
    Authorization: `Bearer ${config.bearer}`,
    Origin: config.origin,
    Referer: `${config.origin}/`,
    "User-Agent": USER_AGENT,
    "X-Requested-With": "XMLHttpRequest",
  };
  if (config.cookie) headers.Cookie = config.cookie;

  let response;
  try {
    response = await fetch(url, { method: "GET", redirect: "manual", headers });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "network error";
    throw new Error(`Could not reach Keka at ${url.origin}: ${reason}`);
  }

  const location = response.headers.get("location") ?? "";
  if (response.status >= 300 && response.status < 400) {
    if (looksLikeLoginPage("", location)) throw new KekaSessionError(sessionExpiredMessage());
    throw new Error(`Keka redirected ${pathname} with HTTP ${response.status}.`);
  }
  const raw = await response.text();
  const contentType = response.headers.get("content-type") ?? "";
  if (response.status === 401 || response.status === 403 || looksLikeLoginPage(raw, location)) {
    throw new KekaSessionError(sessionExpiredMessage());
  }
  if (!response.ok) {
    const detail = raw.replace(/\s+/g, " ").slice(0, 240);
    throw new Error(`Keka ${pathname} failed with HTTP ${response.status}${detail ? `: ${detail}` : "."}`);
  }
  if (!contentType.includes("json") && raw.trim().startsWith("<")) throw new KekaSessionError(sessionExpiredMessage());
  if (!raw.trim()) return null;
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`Keka ${pathname} returned a non-JSON body.`);
  }
}

function textResult(value) {
  return { content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] };
}

function errorResult(error) {
  const message = error instanceof Error ? error.message : "Unknown Keka error.";
  return { isError: true, content: [{ type: "text", text: message }] };
}

const dateField = z.string().regex(ISO_DATE, "Use YYYY-MM-DD.");
const dateArgs = z.object({
  forDate: dateField.optional().describe("Calendar date in YYYY-MM-DD. Defaults to today on this machine."),
});
const rangeArgs = z.object({
  fromDate: dateField.optional().describe("First day, YYYY-MM-DD. Defaults to 6 days before toDate."),
  toDate: dateField.optional().describe("Last day, YYYY-MM-DD. Defaults to today on this machine."),
});
const yearRangeArgs = z.object({
  fromDate: dateField.optional().describe("First day, YYYY-MM-DD. Defaults to 1 January of this year."),
  toDate: dateField.optional().describe("Last day, YYYY-MM-DD. Defaults to today on this machine."),
});
const noArgs = z.object({});

function rangeFrom(args) {
  const end = args.toDate ?? todayLocal();
  const start = args.fromDate ?? shiftIsoDate(end, -6);
  if (start > end) throw new Error("fromDate must be on or before toDate.");
  return { fromDate: start, toDate: end };
}

function yearToDateRange(args = {}) {
  const end = args.toDate ?? todayLocal();
  const start = args.fromDate ?? `${end.slice(0, 4)}-01-01`;
  if (start > end) throw new Error("fromDate must be on or before toDate.");
  return { fromDate: start, toDate: end };
}

function lastWeekRange() {
  const today = new Date();
  const weekday = today.getDay();
  const daysSinceMonday = weekday === 0 ? 6 : weekday - 1;
  const thisMonday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - daysSinceMonday);
  const lastMonday = new Date(thisMonday.getFullYear(), thisMonday.getMonth(), thisMonday.getDate() - 7);
  const lastSunday = new Date(thisMonday.getFullYear(), thisMonday.getMonth(), thisMonday.getDate() - 1);
  return { fromDate: formatLocal(lastMonday), toDate: formatLocal(lastSunday) };
}

const RANGE_REQUIRED_PATHS = new Set([
  "/api/mytime/attendance/adjustmentrequests",
  "/api/mytime/attendance/attendancerequests",
  "/api/mytime/attendance/partialdayrequests",
  "/api/mytime/attendance/remoteclockinrequests",
  "/api/mytime/attendance/workingremotelyrequests",
  "/api/mytime/attendance/allpendingrequestscount",
]);

function queryFor(pathname, query) {
  const next = { ...query };
  if (RANGE_REQUIRED_PATHS.has(pathname)) return { ...yearToDateRange(next), ...next };
  if (pathname === "/api/mytime/attendance/lastweekstats" && (!next.fromDate || !next.toDate)) return lastWeekRange();
  if (pathname === "/api/me/leave/stats" && !next.forDate) next.forDate = todayLocal();
  return Object.keys(next).length > 0 ? next : undefined;
}

function addTool(server, name, description, inputSchema, read) {
  server.registerTool(name, { description, inputSchema }, async (args, ctx) => {
    try {
      const config = await ensureSession(ctx);
      if (config?.resultType === "input_required") return config;
      return textResult(await read(config, args));
    } catch (error) {
      if (error instanceof KekaSessionError) {
        await clearSession();
        return askForCurl();
      }
      return errorResult(error);
    }
  });
}

function addGet(server, name, description, pathname, inputSchema = noArgs, query) {
  addTool(server, name, description, inputSchema, (config, args) => kekaGet(config, pathname, query?.(args)));
}

function createServer() {
  const server = new McpServer({ name: "keka-employee", version: "1.0.0" });

  addGet(server, "get_profile_info", "Signed-in employee's profile header.", "/api/me/publicprofile");
  addGet(server, "get_profile_completion", "Whether the signed-in employee has completed their profile.", "/api/me/isprofilecompleted");
  addGet(server, "get_id_card", "Signed-in employee's ID card details.", "/api/me/idcard");
  addGet(server, "get_timeline", "Signed-in employee's timeline events.", "/api/me/timelineevents");
  addGet(server, "get_preferences", "Signed-in employee's Keka preferences.", "/api/me/preferences");
  addGet(server, "get_probation_policy", "Signed-in employee's probation policy.", "/api/me/probation/policy");
  addGet(server, "get_exit_status", "Signed-in employee's resignation and exit details, when the module is enabled.", "/api/v1/me/exit-details");

  addGet(
    server,
    "get_leave_balance",
    "Remaining time-off summary for the signed-in employee.",
    "/api/me/leave/summary",
    dateArgs,
    (args) => ({ forDate: args.forDate ?? todayLocal() }),
  );
  addTool(server, "get_leave_requests", "Leave requests for the signed-in employee on one date.", dateArgs, (config, args) =>
    kekaGet(config, `/api/me/leave/requests/${args.forDate ?? todayLocal()}`),
  );
  addGet(
    server,
    "get_leave_transactions",
    "Leave transactions for the signed-in employee.",
    "/api/me/leave/leavetransactions",
    yearRangeArgs,
    (args) => yearToDateRange(args),
  );
  addGet(
    server,
    "get_leave_stats",
    "Leave stats for the signed-in employee on one date.",
    "/api/me/leave/stats",
    dateArgs,
    (args) => ({ forDate: args.forDate ?? todayLocal() }),
  );
  addGet(server, "get_holidays", "Holiday list from the signed-in employee's leave plan.", "/api/me/leave/holidays");
  addGet(server, "get_weekly_off_policy", "Weekly off policy for the signed-in employee.", "/api/me/weeklyoffpolicy");
  addGet(server, "get_leave_plan_status", "Whether a leave plan is assigned to the signed-in employee.", "/api/me/leave/isleaveplanassigned");
  addGet(server, "get_pending_leave_encashment", "Pending leave encashment requests for the signed-in employee.", "/api/me/leave/pending/encashmentrequests");

  addTool(
    server,
    "get_attendance_status",
    "Today's punch, current shift clock-in, and attendance summaries for the signed-in employee.",
    rangeArgs,
    async (config, args) => {
      const { fromDate, toDate } = rangeFrom(args);
      const [clockInToday, currentShift, summaries] = await Promise.all([
        kekaGet(config, "/api/me/clockInDetailsForToday"),
        kekaGet(config, "/api/mytime/attendance/current-shift-clock-in-details"),
        kekaGet(config, "/api/mytime/attendance/getattendancesummaries", { fromDate, toDate }),
      ]);
      return { fromDate, toDate, clockInToday, currentShift, summaries };
    },
  );
  addGet(
    server,
    "get_attendance_calendar",
    "Attendance calendar for the signed-in employee.",
    "/api/mytime/attendance/calendar",
    rangeArgs,
    (args) => rangeFrom(args),
  );
  addGet(server, "get_attendance_summary", "Current attendance summary for the signed-in employee.", "/api/mytime/attendance/summary");
  addGet(server, "get_shift_details", "Shift and weekly-off details for the signed-in employee.", "/api/mytime/attendance/shiftweekoffdetails");
  addGet(
    server,
    "get_shift_policy",
    "Shift policy for the signed-in employee.",
    "/api/mytime/attendance/shiftpolicy",
    dateArgs,
    (args) => ({ date: args.forDate ?? todayLocal() }),
  );
  addGet(
    server,
    "get_last_week_attendance",
    "Last week's attendance stats for the signed-in employee.",
    "/api/mytime/attendance/lastweekstats",
    noArgs,
    () => lastWeekRange(),
  );
  addGet(
    server,
    "get_attendance_requests",
    "Attendance regularization requests for the signed-in employee.",
    "/api/mytime/attendance/attendancerequests",
    yearRangeArgs,
    (args) => yearToDateRange(args),
  );
  addGet(
    server,
    "get_adjustment_requests",
    "Attendance adjustment requests for the signed-in employee.",
    "/api/mytime/attendance/adjustmentrequests",
    yearRangeArgs,
    (args) => yearToDateRange(args),
  );
  addGet(
    server,
    "get_partial_day_requests",
    "Partial-day requests for the signed-in employee.",
    "/api/mytime/attendance/partialdayrequests",
    yearRangeArgs,
    (args) => yearToDateRange(args),
  );
  addTool(
    server,
    "get_remote_work_requests",
    "Remote clock-in and working-remotely requests for the signed-in employee.",
    yearRangeArgs,
    async (config, args) => {
      const range = yearToDateRange(args);
      return {
        remoteClockIn: await kekaGet(config, "/api/mytime/attendance/remoteclockinrequests", range),
        workingRemotely: await kekaGet(config, "/api/mytime/attendance/workingremotelyrequests", range),
      };
    },
  );
  addTool(server, "get_attendance_policy", "Attendance capture scheme and tracking policy for the signed-in employee.", noArgs, async (config) => ({
    captureScheme: await kekaGet(config, "/api/mytime/attendance/attendancecapturescheme"),
    trackingPolicy: await kekaGet(config, "/api/mytime/attendance/trackingpolicy"),
  }));
  addGet(
    server,
    "get_pending_attendance_count",
    "Count of the signed-in employee's pending attendance requests.",
    "/api/mytime/attendance/allpendingrequestscount",
    yearRangeArgs,
    (args) => yearToDateRange(args),
  );
  addGet(server, "get_current_shifts", "Current shift schedules for the signed-in employee.", "/api/mytime/attendance/current/shift-schedules-and-job-codes");

  addGet(server, "get_expense_policy", "Expense policy for the signed-in employee.", "/api/me/expenses/policy");
  addGet(server, "get_pending_expenses", "Pending expense bills for the signed-in employee.", "/api/me/expenses/bills/pending");
  addTool(server, "get_expense_claims", "Pending and past expense claims for the signed-in employee.", yearRangeArgs, async (config, args) => {
    const range = yearToDateRange(args);
    return {
      pending: await kekaGet(config, "/api/me/expenses/claims/pending"),
      past: await kekaGet(config, "/api/me/expenses/claims/past", {
        paidFromDate: range.fromDate,
        paidToDate: range.toDate,
      }),
    };
  });
  addTool(server, "get_advance_requests", "Pending and unclaimed advance requests for the signed-in employee.", noArgs, async (config) => ({
    pending: await kekaGet(config, "/api/me/expenses/advancerequests/pending"),
    unclaimed: await kekaGet(config, "/api/me/expenses/advancerequests/unclaimed"),
  }));

  addGet(server, "get_timesheet_profile", "Timesheet profile for the signed-in employee.", "/api/mytimesheet/profile");
  addGet(server, "get_timesheets", "Timesheet summary for the signed-in employee.", "/api/mytimesheet/timesheets");
  addGet(server, "get_timesheets_due", "Timesheets due for the signed-in employee.", "/api/mytimesheet/timesheetsdue");
  addGet(server, "get_rejected_timesheets", "Rejected timesheets for the signed-in employee.", "/api/mytimesheet/timesheetsrejected");
  addGet(server, "get_timesheet_policy", "Timesheet policy for the signed-in employee.", "/api/mytimesheet/policy");

  addGet(server, "get_my_assets", "Assets assigned to the signed-in employee.", "/api/me/asset/all");
  addGet(server, "get_asset_requests", "Asset requests made by the signed-in employee.", "/api/me/asset/request");
  addGet(server, "get_payroll_preferences", "Payroll preferences for the signed-in employee.", "/api/mypayroll/preference");
  addGet(server, "get_pending_approvals", "Count of inbox items waiting on the signed-in employee.", "/api/inbox/pendingapprovalscount");
  addGet(server, "get_feedback_settings", "Feedback settings visible to the signed-in employee.", "/api/myprofile/feedback/settings");
  addGet(server, "get_praise_badges", "Praise badges available to the signed-in employee.", "/api/myprofile/feedback/praisebadges");

  return server;
}

await loadSession();
await serveStdio(createServer);
