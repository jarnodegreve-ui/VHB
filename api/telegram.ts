import type express from "express";
import { timingSafeEqual } from "node:crypto";
import { escapeHtml } from "./email.js";
import { addDagen } from "./advisor.js";
import { getLeaveData, getPlanningData, getPlanningCodesData, getPlanningMatrixRows, getServicesData, getUsersData } from "./storage.js";
import { sharedCheck } from "./rateLimit.js";
import { matrixCodesForDate, toLookupToken } from "./helpers.js";
import type { DayGap } from "./coverageGaps.js";

/**
 * Telegram-koppeling voor de planner — het beproefde patroon uit Jarno's
 * andere apps (webhook met secret-header, chat-id via env, tokens nooit in
 * code of chat). Eén gekoppelde chat (de planner); al het andere wordt stil
 * genegeerd. Sinds v2 kan de bot óók schrijven (verlof/ruil beslissen,
 * ziekmelden, toewijzen): elke schrijfactie zit achter een expliciete
 * bevestigknop, een in-flight-guard tegen dubbele tikken/herbezorgingen, en
 * de idempotentie-guards in de kernen zelf (ifStatus, overlap-dedupe,
 * al-bemand-check) — dáár rust de dubbele-aflevering-veiligheid op, niet op
 * update_id-administratie.
 *
 * Env: TELEGRAM_BOT_TOKEN (van BotFather), TELEGRAM_WEBHOOK_SECRET (zelf
 * gegenereerd, meegegeven aan setWebhook), TELEGRAM_CHAT_ID (de gekoppelde
 * chat; /start toont hem zolang hij nog niet ingesteld is).
 */

const botToken = () => String(process.env.TELEGRAM_BOT_TOKEN ?? "").trim();
const gekoppeldeChat = () => String(process.env.TELEGRAM_CHAT_ID ?? "").trim();

export const telegramGeconfigureerd = (): boolean => Boolean(botToken() && gekoppeldeChat());

export type TelegramKnop = { tekst: string; data: string };

type Verzending = {
  chatId: string;
  tekst: string;
  knoppen?: TelegramKnop[][];
};

const echteVerzender = async (v: Verzending): Promise<boolean> => {
  const token = botToken();
  if (!token) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: v.chatId,
        text: v.tekst,
        // HTML i.p.v. Markdown: namen met _ of * braken Markdown-parsing
        // (bekende valkuil uit de eerdere bots).
        parse_mode: "HTML",
        ...(v.knoppen && v.knoppen.length > 0
          ? { reply_markup: { inline_keyboard: v.knoppen.map((rij) => rij.map((k) => ({ text: k.tekst, callback_data: k.data }))) } }
          : {}),
      }),
    });
    if (!res.ok) console.error("[telegram] sendMessage faalde:", res.status, (await res.text()).slice(0, 300));
    return res.ok;
  } catch (err: any) {
    console.error("[telegram] sendMessage faalde:", err?.message ?? err);
    return false;
  }
};

// Injecteerbare verzender zodat integratietests de uitgaande berichten kunnen
// opvangen zonder echt netwerkverkeer (zelfde idee als de storage-mock).
let verzender = echteVerzender;
export const zetTelegramVerzenderVoorTests = (v: typeof echteVerzender | null) => {
  verzender = v ?? echteVerzender;
};

/** Stuur een bericht naar de gekoppelde planner-chat. Best-effort: nooit
 *  throwen — een kapotte Telegram-config mag geen enkele flow breken. */
export const stuurTelegram = async (
  tekst: string,
  opts?: { knoppen?: TelegramKnop[][]; chatId?: string },
): Promise<boolean> => {
  const chatId = opts?.chatId ?? gekoppeldeChat();
  if (!chatId) return false;
  return verzender({ chatId, tekst, knoppen: opts?.knoppen });
};

const answerCallback = async (callbackId: string, tekst?: string): Promise<void> => {
  const token = botToken();
  if (!token) return;
  try {
    // Zonder antwoord blijft de knop in de Telegram-app eeuwig "laden"
    // (bekende valkuil uit de eerdere bots).
    await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: callbackId, ...(tekst ? { text: tekst } : {}) }),
    });
  } catch (err: any) {
    console.error("[telegram] answerCallbackQuery faalde:", err?.message ?? err);
  }
};

const timingSafeGelijk = (a: string, b: string): boolean => {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
};

// ---------------------------------------------------------------------------
// Opmaak — compact genoeg voor een telefoonscherm, namen altijd ge-escaped.
// ---------------------------------------------------------------------------

export const DAG_KORT = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("nl-BE", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/Brussels" });

/** Kandidaten-knoppen voor open diensten — één bouwer met de vangrails
 *  (cap + Telegram's 64-byte-limiet op callback_data) voor alle plekken. */
const kandidaatKnoppen = (items: Array<{ date: string; code: string }>, cap = 8): TelegramKnop[][] =>
  items
    .slice(0, cap)
    .map((i) => [{ tekst: `👤 Kandidaten ${DAG_KORT(i.date)} · ${i.code}`, data: `adv|${i.date}|${i.code}` }])
    .filter((rij) => rij[0].data.length <= 64 && !rij[0].data.slice(4).includes("|" + "|"));

/** Openstaande diensten als bericht + kandidaten-knoppen (max 8). */
export const formatGaten = (dagen: DayGap[]): { tekst: string; knoppen: TelegramKnop[][] } => {
  const metGaten = dagen.filter((d) => d.missing.length > 0);
  if (metGaten.length === 0) {
    return { tekst: "✅ Geen openstaande diensten in deze periode.", knoppen: [] };
  }
  const regels: string[] = [];
  for (const d of metGaten) {
    const items = d.missing.map((code) => {
      const info = d.uitval?.[code.trim().toLowerCase()];
      // Codes óók escapen: één "&" of "<" in een geconfigureerde code liet
      // Telegram anders het hele (briefing)bericht weigeren.
      return info ? `${escapeHtml(code)} (${escapeHtml(info.name)} · ${escapeHtml(info.reason)})` : escapeHtml(code);
    });
    regels.push(`<b>${DAG_KORT(d.date)}</b>${d.dayType ? ` · ${escapeHtml(d.dayType)}` : ""} — ${items.join(", ")}`);
  }
  const knoppen = kandidaatKnoppen(metGaten.flatMap((d) => d.missing.map((code) => ({ date: d.date, code }))));
  const totaal = metGaten.reduce((n, d) => n + d.missing.length, 0);
  return {
    tekst: `⚠️ <b>${totaal} openstaande dienst${totaal === 1 ? "" : "en"}</b>\n${regels.join("\n")}`,
    knoppen,
  };
};

/** Het invaladvies voor één gat, in de vorm van de collega-samenvatting. */
const formatAdvies = (
  date: string,
  code: string,
  advies: { samenvatting?: string; kandidaten?: Array<{ name: string; past: boolean }> },
): string => {
  const passend = (advies.kandidaten ?? []).filter((k) => k.past).slice(0, 3);
  const regels = [
    `👤 <b>Dienst ${escapeHtml(code)} · ${DAG_KORT(date)}</b>`,
    escapeHtml(String(advies.samenvatting ?? "Geen advies beschikbaar.")),
  ];
  if (passend.length > 0) {
    regels.push(`Passend: ${passend.map((k) => escapeHtml(k.name)).join(", ")}.`);
  }
  regels.push("Toewijzen doe je in het portaal → Openstaande diensten.");
  return regels.join("\n");
};

const vandaagIso = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Brussels" });

export const formatZiek = async (): Promise<string> => {
  const vandaag = vandaagIso();
  const [leave, users] = await Promise.all([getLeaveData({ endOnOrAfter: vandaag }), getUsersData()]);
  const naam = (id: string) => (users as any[]).find((u) => String(u.id) === id)?.name ?? "Onbekend";
  const actueel = (leave as any[])
    .filter((l) => l?.status === "approved" && l?.type === "ziekte" && String(l.endDate) >= vandaag)
    .sort((a, b) => String(a.endDate).localeCompare(String(b.endDate)));
  if (actueel.length === 0) return "✅ Niemand ziek gemeld op dit moment.";
  const regels = actueel.map((l) => {
    const start = String(l.startDate);
    const eind = String(l.endDate);
    const status = start > vandaag ? `vanaf ${DAG_KORT(start)}` : `t/m ${DAG_KORT(eind)}`;
    return `• ${escapeHtml(naam(String(l.userId)))} — ${status}`;
  });
  return `🤒 <b>Ziek gemeld (${actueel.length})</b>\n${regels.join("\n")}`;
};

export const formatVandaag = async (dagen: DayGap[]): Promise<string> => {
  const vandaag = vandaagIso();
  const planning = await getPlanningData({ monthIso: vandaag.slice(0, 7) });
  const rijen = (planning as any[]).filter((s) => String(s.date) === vandaag);
  const diensten = new Set(rijen.map((s) => String(s.line ?? "").trim()).filter(Boolean));
  const chauffeurs = new Set(rijen.map((s) => String(s.driverId)));
  const gat = dagen.find((d) => d.date === vandaag);
  const open = gat?.missing ?? [];
  const regels = [
    `📅 <b>Vandaag (${DAG_KORT(vandaag)})</b>`,
    `${diensten.size} dienst${diensten.size === 1 ? "" : "en"} ingepland, ${chauffeurs.size} chauffeur${chauffeurs.size === 1 ? "" : "s"}.`,
    // Zonder matrixrij is er niets bekend — dat is géén "alles ingevuld".
    !gat ? "⚠️ Geen geïmporteerde planning voor vandaag." : open.length > 0 ? `⚠️ Open: ${open.map((c) => escapeHtml(c)).join(", ")}.` : "✅ Alles ingevuld.",
  ];
  return regels.join("\n");
};

/** Planning-rijen (de actuele, ruil-correcte waarheid) binnen [van, tot]. */
const planningInVenster = async (van: string, tot: string): Promise<any[]> => {
  const maanden = new Set<string>();
  for (let d = van; d <= tot; d = addDagen(d, 1)) maanden.add(d.slice(0, 7));
  const chunks = await Promise.all([...maanden].map((m) => getPlanningData({ monthIso: m })));
  return (chunks.flat() as any[]).filter((s) => {
    const d = String(s?.date ?? "");
    return d >= van && d <= tot;
  });
};

const dienstSegmenten = (s: any): string[] => [
  s.startTime && s.endTime ? `${s.startTime}–${s.endTime}${s.loopnr ? ` (loop ${s.loopnr})` : ""}` : "",
  s.startTime2 && s.endTime2 ? `${s.startTime2}–${s.endTime2}${s.loopnr2 ? ` (loop ${s.loopnr2})` : ""}` : "",
  s.startTime3 && s.endTime3 ? `${s.startTime3}–${s.endTime3}${s.loopnr3 ? ` (loop ${s.loopnr3})` : ""}` : "",
].filter(Boolean);

/** /dienst <code>: de tijden uit het Dienstoverzicht (of de planningscode-uitleg). */
const formatDienst = async (code: string): Promise<string> => {
  if (!code) return "Gebruik: /dienst &lt;nummer&gt; — bv. /dienst 2601.";
  const [services, codes] = await Promise.all([getServicesData(), getPlanningCodesData()]);
  const svc = (services as any[]).find((s) => toLookupToken(String(s.serviceNumber ?? "")) === toLookupToken(code));
  if (svc) {
    const seg = dienstSegmenten(svc);
    return `🚌 <b>Dienst ${escapeHtml(String(svc.serviceNumber))}</b>\n${seg.length > 0 ? seg.map((x) => `• ${escapeHtml(x)}`).join("\n") : "Geen tijden in het Dienstoverzicht."}`;
  }
  const pc = (codes as any[]).find((c) => toLookupToken(String(c.code ?? "")) === toLookupToken(code));
  if (pc) return `ℹ️ ${escapeHtml(code)} is geen dienst maar een planningscode: ${escapeHtml(String(pc.description || pc.code))}.`;
  return `Dienst ${escapeHtml(code)} staat niet in het Dienstoverzicht.`;
};

/** /wie <code>: wie rijdt deze dienst in [van, tot] (ruil-correct). */
const formatWie = async (code: string, van: string, tot: string): Promise<string> => {
  if (!code) return "Gebruik: /wie &lt;dienstnummer&gt; — bv. /wie 2114.";
  const [rijen, users] = await Promise.all([planningInVenster(van, tot), getUsersData()]);
  const naam = (id: string) => (users as any[]).find((u) => String(u.id) === id)?.name ?? `Onbekend (${id})`;
  const perDag = new Map<string, Set<string>>();
  for (const s of rijen) {
    if (toLookupToken(String(s.line ?? "")) !== toLookupToken(code)) continue;
    const d = String(s.date);
    if (!perDag.has(d)) perDag.set(d, new Set());
    perDag.get(d)!.add(naam(String(s.driverId)));
  }
  if (perDag.size === 0) return `Niemand ingepland op dienst ${escapeHtml(code)} van ${DAG_KORT(van)} t/m ${DAG_KORT(tot)}.`;
  const regels = [...perDag.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([d, namen]) => `• ${DAG_KORT(d)}: ${[...namen].map(escapeHtml).join(", ")}`);
  return `🚌 <b>Dienst ${escapeHtml(code)}</b> — ${DAG_KORT(van)} t/m ${DAG_KORT(tot)}:\n${regels.join("\n")}`;
};

/** Fuzzy chauffeur-match op naam: één treffer of een nette uitlegtekst.
 *  Eén bron voor /rooster en /ziekmeld — de drie-takken-UX dreef al uiteen. */
const vindChauffeur = async (query: string): Promise<{ chauffeur: any } | { melding: string }> => {
  const users = await getUsersData();
  const chauffeurs = (users as any[]).filter((u) => u.role === "chauffeur" && u.isActive !== false);
  const q = toLookupToken(query);
  const matches = chauffeurs.filter((u) => toLookupToken(String(u.name ?? "")).includes(q));
  if (matches.length === 0) return { melding: `Geen chauffeur gevonden voor "${escapeHtml(query)}".` };
  if (matches.length > 1) {
    return { melding: `Meerdere chauffeurs matchen "${escapeHtml(query)}": ${matches.slice(0, 6).map((u) => escapeHtml(String(u.name))).join(", ")}${matches.length > 6 ? ", …" : ""}. Wees iets specifieker.` };
  }
  return { chauffeur: matches[0] };
};

/** /rooster <naam>: iemands week — diensten uit de planning (ruil-correct),
 *  andere dagen de matrix-code (vrij/ziek/bv…). */
const formatRooster = async (query: string, van: string, tot: string): Promise<string> => {
  if (!query) return "Gebruik: /rooster &lt;naam&gt; — bv. /rooster Danny.";
  const treffer = await vindChauffeur(query);
  if ("melding" in treffer) return treffer.melding;
  const u = treffer.chauffeur;
  const [rijen, matrix] = await Promise.all([planningInVenster(van, tot), getPlanningMatrixRows()]);
  const perDag = new Map<string, string[]>();
  for (const s of rijen) {
    if (String(s.driverId) !== String(u.id)) continue;
    const d = String(s.date);
    const tijd = s.startTime && s.endTime ? ` (${s.startTime}–${s.endTime})` : "";
    perDag.set(d, [...(perDag.get(d) ?? []), `${String(s.line ?? "?")}${tijd}`]);
  }
  const regels: string[] = [];
  for (let d = van; d <= tot; d = addDagen(d, 1)) {
    const diensten = perDag.get(d);
    if (diensten) {
      regels.push(`• ${DAG_KORT(d)}: ${diensten.map(escapeHtml).join(" + ")}`);
      continue;
    }
    const cel = matrixCodesForDate(matrix as any[], [{ id: String(u.id), name: String(u.name) }], d).get(String(u.id));
    regels.push(`• ${DAG_KORT(d)}: ${cel ? escapeHtml(cel) : "—"}`);
  }
  return `📋 <b>${escapeHtml(String(u.name))}</b> — ${DAG_KORT(van)} t/m ${DAG_KORT(tot)}:\n${regels.join("\n")}`;
};

/** /ziekmeld <naam> [t/m <wanneer>]: interpretatie tonen + bevestigknop.
 *  De knop-tik is de bevestiging; registratie loopt via dezelfde kern als
 *  het portaal (validatie, dedupe, mails, pushes). */
const bereidZiekmeldingVoor = async (arg: string, vandaag: string): Promise<string | { tekst: string; knoppen: TelegramKnop[][] }> => {
  if (!arg) return "Gebruik: /ziekmeld &lt;naam&gt; [t/m &lt;dag&gt;] — bv. /ziekmeld danny t/m vrijdag.";
  const delen = arg.split(/\s+(?:t\/m|tm|tot)\s+/i);
  const naamDeel = delen[0].trim();
  const eindDeel = delen.length > 1 ? delen[delen.length - 1].trim() : "";
  const eind = eindDeel ? parseDagAanduiding(eindDeel, vandaag) : vandaag;
  if (!eind) return `Ik begrijp "${escapeHtml(eindDeel)}" niet als dag — gebruik bv. "t/m vrijdag", "t/m 29/08" of "t/m morgen".`;
  const treffer = await vindChauffeur(naamDeel);
  if ("melding" in treffer) return treffer.melding;
  const u = treffer.chauffeur;
  const data = `zm|${String(u.id)}|${vandaag}|${eind}`;
  if (data.length > 64) return "Deze combinatie is te lang voor een Telegram-knop — registreer via het Ziekte-blad.";
  return {
    tekst: `🤒 Ziek melden: <b>${escapeHtml(String(u.name))}</b>, ${DAG_KORT(vandaag)}${eind !== vandaag ? ` t/m ${DAG_KORT(eind)}` : " (alleen vandaag)"}. Klopt dat?`,
    knoppen: [[{ tekst: "✅ Registreer", data }, { tekst: "Annuleren", data: "nvt" }]],
  };
};

const HULP = [
  "Ik ben de VHB-portaal-bot. Commando's:",
  "/gaten — openstaande diensten komende 7 dagen (met kandidaten-knoppen)",
  "/ziek — wie is er nu ziek gemeld",
  "/vandaag — de dag in het kort",
  "/wie 2114 — wie rijdt deze dienst, komende 7 dagen",
  "/rooster Danny — iemands week",
  "/dienst 2601 — de tijden van een dienst",
  "/ziekmeld danny t/m vrijdag — ziekmelding registreren (met bevestigknop)",
  "Gewone tekst — een vraag aan de planner-assistent",
].join("\n");

// ---------------------------------------------------------------------------
// Webhook
// ---------------------------------------------------------------------------

export type TelegramDeps = {
  berekenDekkingsGaten: (from: string, to: string) => Promise<DayGap[]>;
  berekenCoverageAdvies: (date: string, code: string) => Promise<any>;
  // Schrijfacties — allemaal achter jouw chat-id + een expliciete
  // bevestigknop; de actor verschijnt als "Jarno (via Telegram)" in het
  // activiteitenlog. De kernen zijn exact dezelfde functies als de routes.
  beslisVerlof: (opts: { id: string; status: string; ifStatus: string; actor: any }) => Promise<any>;
  beslisRuil: (opts: { id: string; status: string; ifStatus: string | null; actor: any }) => Promise<any>;
  registreerZiekmelding: (invoer: { userId: unknown; startDate?: unknown; endDate?: unknown; comment?: unknown }, actor: any, stuurTelegramAlert?: boolean) => Promise<any>;
  wijsDienstToe: (invoer: { date: unknown; serviceNumber: unknown; driverId: unknown }, actor: any) => Promise<any>;
  draaiPlannerChat: (gesprek: Array<{ role: "user" | "assistant"; content: any }>) => Promise<{ ok: true; antwoord: string } | { ok: false; status: number; error: string; code?: string }>;
};

/** De bot handelt namens de gekoppelde planner (chat-id = Jarno). Eerlijke
 *  attributie in log en mails. Zet TELEGRAM_ACTOR_USER_ID op het portaal-
 *  user-id van de gekoppelde planner: dan werken ook de "niet de actor
 *  zelf"-filters (geen push/mail over je eigen bot-actie); zonder die env
 *  geldt een placeholder-id dat nooit iemand matcht. */
const BOT_ACTOR = {
  get id() { return String(process.env.TELEGRAM_ACTOR_USER_ID ?? "").trim() || "telegram-bot"; },
  name: "Jarno (via Telegram)",
  role: "admin" as const,
};

/** Uurlimiet voor assistent-vragen via de bot (het endpoint kost geld per
 *  token). Eerst de gedeelde cross-instance-limiter (Upstash); zonder store
 *  de in-memory teller als vangnet — per instantie, dus zacht. */
const chatBeurten: number[] = [];
const chatBinnenLimiet = async (): Promise<boolean> => {
  const gedeeld = await sharedCheck("telegram-assistent", 60 * 60 * 1000, 20);
  if (gedeeld) return gedeeld.allowed;
  const nu = Date.now();
  while (chatBeurten.length > 0 && nu - chatBeurten[0] > 60 * 60 * 1000) chatBeurten.shift();
  if (chatBeurten.length >= 20) return false;
  chatBeurten.push(nu);
  return true;
};

/** In-flight-guard voor schrijf-callbacks: een dubbele knop-tik of Telegram-
 *  herbezorging mag niet tot twee parallelle uitvoeringen leiden. Per
 *  instantie — de kernen zelf blijven de laatste verdediging (ifStatus,
 *  overlap-dedupe, al-bemand). */
const inFlight = new Set<string>();

/** Dag-aanduiding uit mensentaal: 'vandaag', 'morgen', een weekdagnaam
 *  (eerstvolgende), 'dd/mm', 'dd-mm' of 'jjjj-mm-dd'. Null = onbegrepen. */
export const parseDagAanduiding = (raw: string, vandaag: string): string | null => {
  const t = raw.trim().toLowerCase();
  if (!t || t === "vandaag") return vandaag;
  if (t === "morgen") return addDagen(vandaag, 1);
  // Kalender-echte check: "2026-02-31" matcht elk patroon maar bestaat niet —
  // Date maakt er stil 3 maart van en DAG_KORT toonde "Invalid Date".
  const isEchteDag = (iso: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
    const d = new Date(`${iso}T00:00:00Z`);
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === iso;
  };
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return isEchteDag(t) ? t : null;
  const dm = /^(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{4}))?$/.exec(t);
  if (dm) {
    const maak = (jaar: string) => `${jaar}-${String(Number(dm[2])).padStart(2, "0")}-${String(Number(dm[1])).padStart(2, "0")}`;
    if (dm[3]) return isEchteDag(maak(dm[3])) ? maak(dm[3]) : null;
    // Zonder jaar: "t/m 03/01" in december bedoelt januari van volgend jaar —
    // een datum in het verleden rolt daarom naar het eerstvolgende jaar.
    const ditJaar = maak(vandaag.slice(0, 4));
    if (isEchteDag(ditJaar) && ditJaar >= vandaag) return ditJaar;
    const volgendJaar = maak(String(Number(vandaag.slice(0, 4)) + 1));
    return isEchteDag(volgendJaar) ? volgendJaar : null;
  }
  const WEEKDAGEN = ["zondag", "maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag"];
  const KORT = ["zo", "ma", "di", "wo", "do", "vr", "za"];
  const idx = WEEKDAGEN.indexOf(t) !== -1 ? WEEKDAGEN.indexOf(t) : KORT.indexOf(t);
  if (idx !== -1) {
    const vandaagDow = new Date(`${vandaag}T00:00:00Z`).getUTCDay();
    return addDagen(vandaag, (idx - vandaagDow + 7) % 7);
  }
  return null;
};

/** Wijs-toe-knoppen onder een invaladvies: de top-passende kandidaten. */
const adviesKnoppen = (date: string, code: string, advies: { kandidaten?: Array<{ id: string; name: string; past: boolean }> }): TelegramKnop[][] =>
  (advies.kandidaten ?? [])
    .filter((k) => k.past)
    .slice(0, 3)
    .map((k) => [{ tekst: `✅ Wijs toe: ${k.name}`, data: `wt|${date}|${code}|${k.id}` }])
    .filter((rij) => rij[0].data.length <= 64);

/** Nieuwe verlofaanvraag → melding met goedkeurknoppen (aangeroepen vanuit
 *  de verlof-route zodra een chauffeur iets indient). Best-effort. */
export const meldVerlofAanvraagTelegram = async (info: { id: string; naam: string; typeLabel: string; start: string; eind: string }) => {
  if (!telegramGeconfigureerd()) return;
  // Bewust zónder het vrije-tekst-commentaar van de chauffeur: dat kan
  // medische of privé-context bevatten en hoort niet in een extra kanaal
  // (AVG-afweging controle-ronde 22-08); het staat gewoon in het portaal.
  const periode = info.start === info.eind ? DAG_KORT(info.start) : `${DAG_KORT(info.start)} t/m ${DAG_KORT(info.eind)}`;
  const knopData = `lv|${info.id}|approved`;
  await stuurTelegram(
    `📝 <b>Nieuwe verlofaanvraag</b>\n${escapeHtml(info.naam)} — ${escapeHtml(info.typeLabel)} (${periode})`,
    {
      knoppen: knopData.length <= 64
        ? [[{ tekst: "✅ Goedkeuren", data: `lv|${info.id}|approved` }, { tekst: "❌ Afwijzen", data: `lv|${info.id}|rejected` }]]
        : undefined,
    },
  );
};

/** Geaccepteerde ruil wacht op staf-validatie → melding met knoppen. */
export const meldRuilTerValidatieTelegram = async (info: { id: string; omschrijving: string }) => {
  if (!telegramGeconfigureerd()) return;
  const knopData = `rl|${info.id}|approved`;
  await stuurTelegram(
    `🔁 <b>Dienstruil wacht op validatie</b>
${escapeHtml(info.omschrijving)}
Controleer rij- en rusttijden voor je beslist.`,
    {
      knoppen: knopData.length <= 64
        ? [[{ tekst: "✅ Goedkeuren", data: `rl|${info.id}|approved` }, { tekst: "❌ Afwijzen", data: `rl|${info.id}|rejected` }]]
        : undefined,
    },
  );
};

export function mountTelegramRoutes(app: express.Express, deps: TelegramDeps) {
  app.post("/api/telegram/webhook", async (req, res) => {
    try {
      // Secret-validatie eerst; zonder geconfigureerd secret is de webhook
      // dicht (fail-closed, zelfde principe als de cron-endpoints).
      const secret = String(process.env.TELEGRAM_WEBHOOK_SECRET ?? "").trim();
      const header = String(req.headers["x-telegram-bot-api-secret-token"] ?? "");
      if (!secret || !timingSafeGelijk(header, secret)) {
        return res.status(401).json({ error: "Ongeldige webhook." });
      }

      const update = req.body ?? {};
      const bekend = gekoppeldeChat();

      // Knoppen (callback_query): alleen vanuit de gekoppelde chat.
      const cb = update.callback_query;
      if (cb) {
        // Chat én afzender checken: in een privéchat zijn die gelijk, maar
        // mocht de chat-id ooit een groep worden, dan mag niet elk groepslid
        // op de beslisknoppen drukken.
        const vanChat = String(cb.message?.chat?.id ?? "");
        const afzender = cb.from?.id != null ? String(cb.from.id) : vanChat;
        if (!bekend || vanChat !== bekend || afzender !== bekend) {
          await answerCallback(String(cb.id ?? ""));
          return res.json({ ok: true });
        }
        const data = String(cb.data ?? "");
        const cbId = String(cb.id ?? "");
        if (data.startsWith("adv|")) {
          const [, date, code] = data.split("|");
          await answerCallback(cbId, "Advies berekenen…");
          try {
            const advies = await deps.berekenCoverageAdvies(String(date ?? ""), String(code ?? ""));
            await stuurTelegram(formatAdvies(String(date ?? ""), String(code ?? ""), advies), {
              knoppen: adviesKnoppen(String(date ?? ""), String(code ?? ""), advies),
            });
          } catch {
            await stuurTelegram(`Advies voor dienst ${escapeHtml(String(code ?? ""))} kon niet berekend worden.`);
          }
        } else if (data.startsWith("lv|") || data.startsWith("rl|")) {
          // Stap 1 van een beslissing: expliciete bevestiging vragen — één
          // tik op een knop in een scrollende chat mag nooit direct beslissen.
          const [soort, id, besluit] = data.split("|");
          await answerCallback(cbId);
          const label = besluit === "approved" ? "goedkeuren" : "afwijzen";
          const emoji = besluit === "approved" ? "✅" : "❌";
          await stuurTelegram(
            `${soort === "lv" ? "Verlofaanvraag" : "Dienstruil"} <b>${label}</b>?`,
            { knoppen: [[{ tekst: `${emoji} Ja, ${label}`, data: `${soort}2|${id}|${besluit}` }, { tekst: "Annuleren", data: "nvt" }]] },
          );
        } else if (data.startsWith("lv2|")) {
          if (inFlight.has(data)) {
            await answerCallback(cbId, "Wordt al verwerkt…");
            return res.json({ ok: true });
          }
          inFlight.add(data);
          try {
          const [, id, besluit] = data.split("|");
          await answerCallback(cbId, "Beslissing doorvoeren…");
          const uit = await deps.beslisVerlof({ id: String(id ?? ""), status: String(besluit ?? ""), ifStatus: "pending", actor: BOT_ACTOR });
          await stuurTelegram("fout" in uit ? `⚠️ ${escapeHtml(uit.fout.error)}` : `✅ ${escapeHtml(uit.melding)}`);
          } finally {
            inFlight.delete(data);
          }
        } else if (data.startsWith("rl2|")) {
          if (inFlight.has(data)) {
            await answerCallback(cbId, "Wordt al verwerkt…");
            return res.json({ ok: true });
          }
          inFlight.add(data);
          try {
          const [, id, besluit] = data.split("|");
          await answerCallback(cbId, "Beslissing doorvoeren…");
          const uit = await deps.beslisRuil({ id: String(id ?? ""), status: String(besluit ?? ""), ifStatus: "accepted", actor: BOT_ACTOR });
          await stuurTelegram("fout" in uit ? `⚠️ ${escapeHtml(uit.fout.error)}` : `✅ ${escapeHtml(uit.melding)}`);
          } finally {
            inFlight.delete(data);
          }
        } else if (data.startsWith("zm|")) {
          if (inFlight.has(data)) {
            await answerCallback(cbId, "Wordt al verwerkt…");
            return res.json({ ok: true });
          }
          inFlight.add(data);
          try {
          // De bevestigknop onder de /ziekmeld-interpretatie ís de bevestiging.
          const [, userId, startKnop, eind] = data.split("|");
          await answerCallback(cbId, "Ziekmelding registreren…");
          // De knop bakte de commandodag in — wie hem pas later aantikt,
          // bedoelt "vanaf vandaag", niet "met terugwerkende kracht".
          const nu = vandaagIso();
          const start = String(startKnop ?? "") < nu ? nu : String(startKnop ?? "");
          const bijgesteld = start !== String(startKnop ?? "");
          const uit = await deps.registreerZiekmelding(
            { userId: String(userId ?? ""), startDate: start, endDate: String(eind ?? ""), comment: "Geregistreerd via Telegram." },
            BOT_ACTOR,
            false,
          );
          if ("fout" in uit) {
            await stuurTelegram(`⚠️ ${escapeHtml(uit.fout.error)}`);
          } else {
            const diensten: Array<{ date: string; nummers: string[] }> = uit.openDienstenIso ?? [];
            const regels = diensten.slice(0, 6).map((d) => `• ${DAG_KORT(d.date)}: ${escapeHtml(d.nummers.join(" / "))}`);
            if (diensten.length > 6) regels.push(`• …en nog ${diensten.length - 6} dagen`);
            const knoppen = kandidaatKnoppen(diensten.map((d) => ({ date: d.date, code: d.nummers[0] })), 6);
            const periode = start === String(eind ?? "") ? DAG_KORT(start) : `${DAG_KORT(start)} t/m ${DAG_KORT(String(eind ?? ""))}`;
            await stuurTelegram(
              [
                `🤒 <b>Ziek gemeld:</b> ${escapeHtml(uit.targetName)} (${periode})${bijgesteld ? " — start bijgesteld naar vandaag" : ""}.`,
                diensten.length > 0 ? `Diensten die openvallen:\n${regels.join("\n")}` : "Geen diensten op naam in deze periode.",
              ].join("\n"),
              { knoppen },
            );
          }
          } finally {
            inFlight.delete(data);
          }
        } else if (data.startsWith("wt|")) {
          const [, date, code, userId] = data.split("|");
          await answerCallback(cbId);
          await stuurTelegram(
            `Dienst <b>${escapeHtml(String(code ?? ""))}</b> op ${DAG_KORT(String(date ?? ""))} toewijzen?`,
            { knoppen: [[{ tekst: "✅ Ja, wijs toe", data: `wt2|${date}|${code}|${userId}` }, { tekst: "Annuleren", data: "nvt" }]] },
          );
        } else if (data.startsWith("wt2|")) {
          if (inFlight.has(data)) {
            await answerCallback(cbId, "Wordt al verwerkt…");
            return res.json({ ok: true });
          }
          inFlight.add(data);
          try {
          const [, date, code, userId] = data.split("|");
          await answerCallback(cbId, "Toewijzen…");
          const uit = await deps.wijsDienstToe({ date: String(date ?? ""), serviceNumber: String(code ?? ""), driverId: String(userId ?? "") }, BOT_ACTOR);
          await stuurTelegram(
            "fout" in uit
              ? `⚠️ ${escapeHtml(uit.fout.error)}`
              : `✅ Dienst ${escapeHtml(uit.serviceNumber)} op ${DAG_KORT(uit.date)} toegewezen aan <b>${escapeHtml(uit.driverName)}</b> — de chauffeur krijgt een melding.`,
          );
          } finally {
            inFlight.delete(data);
          }
        } else if (data === "nvt") {
          await answerCallback(cbId, "Niets gedaan.");
        } else {
          await answerCallback(cbId);
        }
        return res.json({ ok: true });
      }

      const msg = update.message;
      const vanChat = String(msg?.chat?.id ?? "");
      const afzender = msg?.from?.id != null ? String(msg.from.id) : vanChat;
      if (!vanChat) return res.json({ ok: true });
      const tekst = String(msg?.text ?? "").trim();

      // Nog niet gekoppeld: /start toont de chat-id zodat die (buiten deze
      // chat om) als TELEGRAM_CHAT_ID in de env gezet kan worden. Andere
      // berichten van wie dan ook: stil negeren.
      if (!bekend) {
        if (tekst.startsWith("/start")) {
          await stuurTelegram(
            `Deze chat heeft id <code>${escapeHtml(vanChat)}</code>.\nZet die waarde als TELEGRAM_CHAT_ID in de Vercel-omgeving en redeploy — daarna is de bot gekoppeld.`,
            { chatId: vanChat },
          );
        }
        return res.json({ ok: true });
      }
      if (vanChat !== bekend || afzender !== bekend) return res.json({ ok: true });

      // Commando + argument; "@botnaam"-suffix strippen (stuurt Telegram in
      // groepen mee — wij zitten in een privéchat, maar defensief kost niks).
      const [cmdRaw = "", ...rest] = tekst.split(/\s+/);
      const cmd = cmdRaw.toLowerCase().replace(/@[\w_]+$/, "");
      const arg = rest.join(" ").trim();
      const vandaag = vandaagIso();
      const eindWeek = addDagen(vandaag, 6);

      if (cmd === "/start" || cmd === "/help") {
        await stuurTelegram(HULP);
      } else if (cmd === "/gaten") {
        const dagen = await deps.berekenDekkingsGaten(vandaag, eindWeek);
        const { tekst: bericht, knoppen } = formatGaten(dagen);
        await stuurTelegram(bericht, { knoppen });
      } else if (cmd === "/ziek") {
        await stuurTelegram(await formatZiek());
      } else if (cmd === "/vandaag") {
        const dagen = await deps.berekenDekkingsGaten(vandaag, vandaag);
        await stuurTelegram(await formatVandaag(dagen));
      } else if (cmd === "/wie") {
        await stuurTelegram(await formatWie(arg, vandaag, eindWeek));
      } else if (cmd === "/rooster") {
        await stuurTelegram(await formatRooster(arg, vandaag, eindWeek));
      } else if (cmd === "/dienst") {
        await stuurTelegram(await formatDienst(arg));
      } else if (cmd === "/ziekmeld") {
        const zmUit = await bereidZiekmeldingVoor(arg, vandaag);
        if (typeof zmUit === "string") await stuurTelegram(zmUit);
        else await stuurTelegram(zmUit.tekst, { knoppen: zmUit.knoppen });
      } else if (cmd.startsWith("/")) {
        await stuurTelegram(`Dat commando ken ik niet.\n\n${HULP}`);
      } else if (tekst) {
        // Vrije tekst = een vraag aan de planner-assistent (zelfde leestools
        // en beknoptheidscontract als in het portaal). Zachte uurlimiet.
        if (!(await chatBinnenLimiet())) {
          await stuurTelegram("Even rustig aan — maximaal 20 assistent-vragen per uur via de bot. Probeer het straks opnieuw of gebruik de Assistent in het portaal.");
        } else {
          const uit = await deps.draaiPlannerChat([{ role: "user", content: tekst.slice(0, 1000) }]);
          await stuurTelegram("antwoord" in uit ? escapeHtml(uit.antwoord) : `⚠️ ${escapeHtml(uit.error)}`);
        }
      }
      return res.json({ ok: true });
    } catch (err: any) {
      console.error("[telegram] webhook faalde:", err?.message ?? err);
      // Tóch 200: bij een 5xx blijft Telegram dezelfde update opnieuw
      // aanbieden, en alles hier is lezen-en-melden — herhalen helpt niet.
      return res.json({ ok: false });
    }
  });
}
