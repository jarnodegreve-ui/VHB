/**
 * Verlof en ziekte: aanvragen, beslissen, ziekmelden, limieten en extra
 * feestdagen.
 *
 * Verhuisd uit api/index.ts (21-09, verbeterronde 4, G1): dat bestand was
 * 6.344 regels en elke wijziging raakte dezelfde importkop. De code is
 * verplaatst, niet herschreven; api/index.ts bouwt de app op en mount de
 * domeinen in dezelfde volgorde als voorheen.
 */

import express from "express";
import crypto from "node:crypto";
import { sendLeaveDecisionEmail, sendEmail, escapeHtml, type LeaveDecisionAction } from "../email.js";
import { sendPushToUsers } from "../push.js";
import type { AuthenticatedRequest } from "../types.js";
import { isStafRol, authenticate, requireRole } from "../middleware.js";
import { isMissingTableError } from "../deviceGate.js";
import { stuurTelegram, telegramGeconfigureerd, meldVerlofAanvraagTelegram } from "../telegram.js";
// Gedeelde API-contracten (zod) — zelfde schemas als de formulieren in src/.
import { VERLOF_LIMIETEN_KEY, limietVoorDag, parseVerlofLimieten, sorteerPeriodes, verlofLimietenSchema } from "../../shared/schemas/verlofLimieten.js";
import { bezettingPerDag } from "../../shared/verlofbezettingPerDag.js";
import { VERLOF_FEESTDAGEN_KEY, parseVerlofFeestdagen, sorteerExtraFeestdagen, verlofFeestdagenSchema } from "../../shared/schemas/verlofFeestdagen.js";
import { valideerRecord } from "./valideer.js";
import { brusselsDay, PERIODE_DMJ, LEAVE_TYPE_LABEL, isActieveStaf } from "../helpers.js";
// Excel-werk (xlsx lui geladen, daarom async): zie api/_lib/matrixXlsx.ts.
import { getLeaveData, getPlanningData, getUsersData, logActivity, saveLeaveData, getAppSetting, setAppSetting } from "../storage.js";
import { type BeslisActor, COLLECTION_REVISION_HEADER, RECORD_ID_RE, actorReq, detectMassDelete, massDeleteResponse, revisionCheck, revisionOf, revisionProbleemResponse, viewUrl } from "./collectie.js";

// Ziekmelding: aparte, directe flow (géén goedkeuring — de chauffeur ís al
// ziek). Maakt een reeds-goedgekeurd 'ziekte'-verlofrecord zodat de dag
// meteen als onbeschikbaar telt in Maandplanning/Dekking, en waarschuwt de
// planning via push + mail. BEWUST alleen planner/admin: ziekmelding komt
// telefonisch bij de planning binnen, die registreert het — een chauffeur
// mag zichzelf niet ziek (in)plannen.
/** De ziekmelding-kern (validatie, dedupe, record, log, openvallende
 *  diensten, pushes en mails) — gedeeld door POST /api/leave/sick-report en
 *  het /ziekmeld-commando van de Telegram-bot. `stuurTelegramAlert` staat uit
 *  wanneer de bot zelf de afzender is (die bouwt zijn eigen antwoord). */
export async function registreerZiekmeldingIntern(
  invoer: { userId: unknown; startDate?: unknown; endDate?: unknown; comment?: unknown },
  actor: BeslisActor,
  stuurTelegramAlert = true,
): Promise<{ fout: { status: number; error: string } } | { leave: any; period: string; targetName: string; openDienstenIso: Array<{ date: string; nummers: string[] }> }> {
    const selfId = String(actor.id);
    const forUserId = String(invoer.userId ?? "");
    if (!forUserId) return { fout: { status: 400, error: "Kies de chauffeur die ziek is." } };

    // Echte kalendercheck, niet alleen het patroon: "2026-02-31" past in de
    // regex maar bestaat niet, en Date maakt er stilletjes 3 maart van — dan
    // klopt geen enkele vergelijking meer.
    const isoDay = (v: unknown): string | null => {
      if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
      const d = new Date(`${v}T00:00:00`);
      return Number.isFinite(d.getTime()) && d.toLocaleDateString("en-CA") === v ? v : null;
    };
    // brusselsDay, niet de UTC-dag: een ziekmelding zonder expliciete datum
    // om 00:30 Brusselse tijd hoort op vandáág te landen — met de UTC-dag
    // belandde ze op gisteren en bleef de dienst van vandaag ingevuld staan.
    const todayLocal = brusselsDay(new Date().toISOString()); // yyyy-mm-dd, Brusselse dag
    if (invoer.startDate != null && !isoDay(invoer.startDate)) {
      return { fout: { status: 400, error: "Ongeldige startdatum." } };
    }
    if (invoer.endDate != null && !isoDay(invoer.endDate)) {
      return { fout: { status: 400, error: "Ongeldige einddatum." } };
    }
    const startDate = isoDay(invoer.startDate) ?? todayLocal;
    const endDate = isoDay(invoer.endDate) ?? startDate;
    if (endDate < startDate) return { fout: { status: 400, error: "Einddatum ligt vóór de startdatum." } };
    // Cap op de periode: één tikfout in het jaartal ("2027" i.p.v. "2026")
    // zette iemand anders permanent ziek in het hele rooster. Een jaar is
    // ruim genoeg voor langdurige ziekte; langer kan altijd via verlengen.
    const spanDagen = Math.round((new Date(`${endDate}T00:00:00`).getTime() - new Date(`${startDate}T00:00:00`).getTime()) / 86400000);
    if (spanDagen > 366) {
      return { fout: { status: 400, error: "Ziekteperiode is langer dan een jaar, controleer de datums (tikfout in het jaartal?)." } };
    }
    const comment = String(invoer.comment ?? "").slice(0, 1000);

    const users = await getUsersData();
    const target = users.find((u) => String(u.id) === forUserId);
    if (!target) return { fout: { status: 400, error: "Onbekende gebruiker." } };
    // Alleen actieve chauffeurs: een admin, planner of ex-medewerker ziek
    // melden registreert gezondheidsdata op de verkeerde plek.
    if (target.role !== "chauffeur" || target.isActive === false) {
      return { fout: { status: 400, error: "Ziek melden kan alleen voor een actieve chauffeur." } };
    }

    const previousLeave = await getLeaveData();
    // Duplicaat-/overlapcheck: een tweede ziekmelding over (deels) dezelfde
    // periode maakt geen extra record maar verwijst naar het bestaande —
    // verlengen of corrigeren gaat via Verlofbeheer.
    const overlappend = previousLeave.find((l: any) =>
      l?.status === "approved" && l?.type === "ziekte" && String(l.userId) === forUserId &&
      String(l.startDate) <= endDate && startDate <= String(l.endDate),
    );
    if (overlappend) {
      const p = PERIODE_DMJ(overlappend.startDate, overlappend.endDate);
      return { fout: { status: 409, error: `${target.name} staat al ziek gemeld voor ${p}. Pas die melding aan via Verlofbeheer.` } };
    }

    const record = {
      id: crypto.randomUUID(),
      userId: forUserId,
      startDate,
      endDate,
      type: "ziekte" as const,
      status: "approved" as const,
      comment,
      createdAt: new Date().toISOString(),
      decidedAt: new Date().toISOString(),
    };
    // Alleen het nieuwe record schrijven — géén snapshot-herschrijf van de
    // hele tabel: die draaide een gelijktijdige verlofbeslissing van een
    // collega-planner stil terug naar de stand van dit request.
    await saveLeaveData([record]);

    const period = PERIODE_DMJ(startDate, endDate);
    await logActivity(actorReq(actor), "leave", "Ziekmelding", `${target.name} ziek gemeld voor ${period} (door ${actor.name}).`, { type: "leave", id: record.id });

    // Welke diensten vallen door deze ziekte open? Per dag van de periode de
    // ingeplande dienst(en) van de chauffeur — dat is wat de planner meteen
    // wil weten (verzoek Jarno 04-08). Gesplitste diensten = meerdere
    // planning-rijen met hetzelfde nummer → dedupliceren per dag.
    // ÁLLE maanden van de periode enumereren, niet alleen start- en eindmaand:
    // bij een ziekte over drie maanden verzweeg de mail anders de middelste
    // maand — zonder enige aanwijzing dat er iets ontbrak.
    const zichtMaanden: string[] = [];
    for (let m = startDate.slice(0, 7); m <= endDate.slice(0, 7); ) {
      zichtMaanden.push(m);
      const [jr, mnd] = m.split("-").map(Number);
      m = mnd === 12 ? `${jr + 1}-01` : `${jr}-${String(mnd + 1).padStart(2, "0")}`;
    }
    const planningChunks = await Promise.all(zichtMaanden.map((m) => getPlanningData({ driverId: forUserId, monthIso: m })));
    const dagDiensten = new Map<string, string[]>(); // datum → dienstnummers
    for (const s of planningChunks.flat() as any[]) {
      // Zelf óók op chauffeur filteren, niet alleen op het storage-filter
      // vertrouwen — een dienst van een collega in deze mail zet de planner
      // op het verkeerde been.
      if (String(s.driverId ?? "") !== forUserId) continue;
      const d = String(s.date ?? "");
      if (d < startDate || d > endDate) continue;
      const nummer = String(s.line ?? "").trim();
      if (!nummer) continue;
      const lijst = dagDiensten.get(d) ?? [];
      if (!lijst.includes(nummer)) dagDiensten.set(d, [...lijst, nummer]);
    }
    const dagLabel = (iso: string) =>
      new Date(`${iso}T00:00:00`).toLocaleDateString("nl-BE", { weekday: "short", day: "numeric", month: "short" });
    const openDiensten = [...dagDiensten.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([d, nummers]) => ({ label: dagLabel(d), nummers: nummers.join(" / ") }));

    // De hele planning waarschuwen. Push gaat niet naar wie het zelf
    // registreerde (een melding over je eigen klik is ruis), maar de mail
    // wél — die dient als vastlegging in de mailbox, en de registrerende
    // planner wil hem juist óók (verzoek Jarno 04-08).
    const planningRollen = users.filter(isActieveStaf);
    const beslissers = planningRollen.filter((u) => String(u.id) !== selfId);
    await sendPushToUsers(beslissers.map((u) => String(u.id)), {
      title: "Ziekmelding",
      soort: "verlof",
      body: `${target.name} is ziek gemeld voor ${period}.`,
      url: viewUrl("ziekte"),
    });
    // Ziekmelding ook naar de gekoppelde Telegram-chat, mét de diensten die
    // erdoor openvallen — dát is wat de planner meteen wil weten. Best-effort.
    if (telegramGeconfigureerd() && stuurTelegramAlert) {
      const dienstRegels = openDiensten.slice(0, 5).map((d) => `• ${d.label}: ${d.nummers}`);
      if (openDiensten.length > 5) dienstRegels.push(`• …en nog ${openDiensten.length - 5} dagen`);
      await stuurTelegram([
        `🤒 <b>Ziekmelding</b>, ${escapeHtml(target.name)} (${period})`,
        openDiensten.length > 0 ? `Diensten op naam in deze periode:\n${dienstRegels.join("\n")}` : "Geen diensten op naam in deze periode.",
      ].join("\n"));
    }
    // Per planner een eigen mail, rechtstreeks geadresseerd — géén BCC-batch.
    // sendEmail zet meerdere ontvangers in BCC (met noreply als To), en
    // Microsoft 365 filterde precies die vorm stilletjes weg: de testmail
    // (direct in To) kwam wél aan op hetzelfde adres (04-08). De BCC-vorm is
    // er tegen adressenlekken bij bulk naar alle chauffeurs; voor een handvol
    // planners die elkaars adres kennen is los versturen veiliger én leest de
    // mail normaal. Volgorde: één voor één, fouten loggen maar niet blokkeren.
    const recipients = planningRollen.filter((u) => u.email).map((u) => u.email as string);
    // Openstaande diensten in de mail (zelfde term als het scherm): "do 6 aug — 4407". Geen diensten in
    // de periode (ziek op vrije dagen) → dat óók gewoon zeggen, dan hoeft de
    // planner het rooster niet open te doen om niets te vinden.
    const dienstenTekst = openDiensten.length > 0
      ? `\n\nOpenstaande dienst(en):\n${openDiensten.map((o) => `- ${o.label}, ${o.nummers}`).join("\n")}\n\nDeze staan nu als onbeschikbaar in de Maandplanning en Dekking.`
      : "\n\nGeen ingeplande diensten in deze periode.";
    const dienstenHtml = openDiensten.length > 0
      ? `<p><strong>Openstaande dienst(en):</strong></p><ul>${openDiensten.map((o) => `<li>${escapeHtml(o.label)}, ${escapeHtml(o.nummers)}</li>`).join("")}</ul><p>Deze staan nu als onbeschikbaar in de Maandplanning en Dekking.</p>`
      : `<p>Geen ingeplande diensten in deze periode.</p>`;
    for (const adres of recipients) {
      await sendEmail({
        to: [adres],
        context: `sick:${forUserId}`,
        subject: `Ziekmelding, ${target.name} (${period})`,
        text: `${target.name} is ziek gemeld voor ${period}.${comment ? `\n\nToelichting: ${comment}` : ""}${dienstenTekst}`,
        html: `<p><strong>${escapeHtml(target.name)}</strong> is ziek gemeld voor <strong>${escapeHtml(period)}</strong>.</p>${comment ? `<p>Toelichting: ${escapeHtml(comment)}</p>` : ""}${dienstenHtml}`,
      });
    }

    return {
      leave: record,
      period,
      targetName: target.name,
      // ISO-variant voor de bot: kandidaten-knoppen hebben de rauwe datum
      // nodig; de label-variant leeft alleen intern (mail/alert).
      openDienstenIso: [...dagDiensten.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([d, nummers]) => ({ date: d, nummers })),
    };
}

/** De verlof-beslissing zelf (concurrency-guard, state-machine, opslag, log,
 *  mail + push) — gedeeld door PATCH /api/leave/:id en de Telegram-knoppen. */
export async function beslisVerlofIntern(opts: { id: string; status: string; ifStatus: string; actor: BeslisActor }): Promise<
  { fout: { status: number; error: string; currentStatus?: string } } | { leave: any; melding: string }
> {
    const { id, status, ifStatus, actor } = opts;
    const allowed = ["approved", "rejected", "cancelled"];
    if (!allowed.includes(status)) {
      return { fout: { status: 400, error: "Ongeldige status." } };
    }

    const all = await getLeaveData();
    const current = all.find((l) => String(l.id) === id);
    if (!current) {
      return { fout: { status: 404, error: "Deze verlofaanvraag bestaat niet (meer), mogelijk net ingetrokken." } };
    }
    if (String(current.status) !== ifStatus) {
      return { fout: { status: 409, error: `Deze aanvraag is intussen al '${current.status}', de lijst is ververst.`, currentStatus: String(current.status) } };
    }
    // State-machine (spiegel van TERMINAL_SWAP_STATES): een afgewezen of
    // geannuleerde aanvraag is een eindstation. approved → cancelled blijft
    // toegestaan ("Verlof annuleren").
    if (status !== current.status && ["rejected", "cancelled"].includes(String(current.status))) {
      return { fout: { status: 409, error: "Deze verlofaanvraag is al afgehandeld en kan niet meer van status veranderen." } };
    }

    const decidedAt = new Date().toISOString();
    const updated = { ...current, status, decidedAt };
    await saveLeaveData([updated], []);

    const users = await getUsersData();
    const requester = users.find((u) => String(u.id) === String(current.userId));
    const requesterName = requester?.name || `Onbekende gebruiker (${current.userId})`;
    const period = PERIODE_DMJ(String(current.startDate), String(current.endDate));
    const typeLabel = LEAVE_TYPE_LABEL[current.type] ?? current.type;
    const actionLabels: Record<string, string> = {
      approved: "Verlof goedgekeurd",
      rejected: "Verlof afgewezen",
      cancelled: "Verlof geannuleerd",
    };
    const action = actionLabels[status]!;
    await logActivity(actorReq(actor), "leave", action, `${requesterName}, ${typeLabel} (${period}).`, { type: "leave", id });

    // E-mail + push naar de aanvrager — niet de actor zelf.
    if (String(actor.id) !== String(current.userId)) {
      if (requester?.email) {
        await sendLeaveDecisionEmail({
          to: requester.email,
          recipientName: requester.name,
          decidedByName: actor.name || "Planning",
          typeLabel,
          startDate: current.startDate,
          endDate: current.endDate,
          action: status as LeaveDecisionAction,
        });
      }
      await sendPushToUsers([String(current.userId)], {
        title: action,
        soort: "verlof",
        body: `${typeLabel} (${period}), beslist door ${actor.name || "Planning"}.`,
        url: viewUrl("verlof"),
      });
    }
    return { leave: updated, melding: `${action}: ${requesterName}, ${typeLabel} (${period}).` };
}

export function mountVerlofRoutes(app: express.Express) {
  // Verloflimieten (verzoek Jarno 09-09): hoeveel chauffeurs tegelijk vrij
  // mogen zijn, standaard plus uitzonderingsperiodes (zomervakantie hoger dan
  // een schoolperiode). Lezen mag elke rol: de kalenderkleuring in Verlof
  // gebruikt het ook voor chauffeurs. Schrijven is admin-werk.
  app.get("/api/verlof/limieten", authenticate, async (_req: AuthenticatedRequest, res) => {
    try {
      res.json(parseVerlofLimieten(await getAppSetting(VERLOF_LIMIETEN_KEY)));
    } catch (err: any) {
      // Zonder instellingen-tabel (of bij een DB-hik) de standaard: de kalender
      // moet blijven werken, de admin ziet de fout pas bij het opslaan.
      if (!isMissingTableError(err)) console.error("Verloflimieten laden is mislukt.", err);
      res.json(parseVerlofLimieten(null));
    }
  });

  app.put("/api/verlof/limieten", authenticate, requireRole("admin"), async (req: AuthenticatedRequest, res) => {
    try {
      const body = valideerRecord(res, verlofLimietenSchema, req.body);
      if (!body) return;
      const limieten = { standaard: body.standaard, periodes: sorteerPeriodes(body.periodes) };
      await setAppSetting(VERLOF_LIMIETEN_KEY, limieten);
      const uitz = limieten.periodes.length;
      await logActivity(
        req,
        "leave",
        "Verloflimieten aangepast",
        `Standaard ${limieten.standaard} tegelijk vrij${uitz > 0 ? `, ${uitz} uitzonderingsperiode${uitz === 1 ? "" : "s"}: ${limieten.periodes.map((p) => `${p.naam} (${p.max})`).join(", ")}` : ", geen uitzonderingsperiodes"}.`,
      );
      res.json(limieten);
    } catch (err: any) {
      if (isMissingTableError(err)) {
        return res.status(503).json({ error: "De instellingen-tabel bestaat nog niet: draai supabase/2026-07-30_app_settings.sql in de SQL Editor." });
      }
      console.error("Verloflimieten opslaan is mislukt.", err);
      res.status(500).json({ error: "Verloflimieten opslaan is mislukt." });
    }
  });

  // Extra vrije dagen (verzoek Jarno 10-09): dagen die net als de wettelijke
  // feestdagen niet meetellen als betaald verlof. De wettelijke feestdagen
  // rekent de client zelf uit; dit is de aanvulling van de beheerder. Lezen
  // mag elke rol (de verloftelling gebruikt het), schrijven is admin-werk.
  app.get("/api/verlof/feestdagen", authenticate, async (_req: AuthenticatedRequest, res) => {
    try {
      res.json(parseVerlofFeestdagen(await getAppSetting(VERLOF_FEESTDAGEN_KEY)));
    } catch (err: any) {
      if (!isMissingTableError(err)) console.error("Extra vrije dagen laden is mislukt.", err);
      res.json(parseVerlofFeestdagen(null));
    }
  });

  app.put("/api/verlof/feestdagen", authenticate, requireRole("admin"), async (req: AuthenticatedRequest, res) => {
    try {
      const body = valideerRecord(res, verlofFeestdagenSchema, req.body);
      if (!body) return;
      const bewaard = { extra: sorteerExtraFeestdagen(body.extra) };
      await setAppSetting(VERLOF_FEESTDAGEN_KEY, bewaard);
      await logActivity(
        req,
        "leave",
        "Extra vrije dagen aangepast",
        bewaard.extra.length === 0
          ? "Geen extra vrije dagen meer naast de wettelijke feestdagen."
          : `${bewaard.extra.length} extra vrije dag${bewaard.extra.length === 1 ? "" : "en"}: ${bewaard.extra.map((d) => `${d.naam} (${d.datum})`).join(", ")}.`,
      );
      res.json(bewaard);
    } catch (err: any) {
      if (isMissingTableError(err)) {
        return res.status(503).json({ error: "De instellingen-tabel bestaat nog niet: draai supabase/2026-07-30_app_settings.sql in de SQL Editor." });
      }
      console.error("Extra vrije dagen opslaan is mislukt.", err);
      res.status(500).json({ error: "Extra vrije dagen opslaan is mislukt." });
    }
  });

  app.get("/api/leave", authenticate, async (req: AuthenticatedRequest, res) => {
    try {
      // Privacy: een chauffeur ziet enkel zijn eigen verlof (incl. de vrije-tekst
      // reden). Planner/admin zien alles (voor verlof-beheer en bezetting).
      // Niet-staf: filter in de query, JS-filter blijft als vangnet (zie /api/swaps).
      const staf = isStafRol(req.appUser!.role);
      const data = await getLeaveData(staf ? undefined : { userId: String(req.appUser!.id) });
      if (!staf) {
        const selfId = String(req.appUser.id);
        return res.json(data.filter((l) => String(l.userId) === selfId));
      }
      // Revisie enkel voor planner/admin (volledige weergave), zie /api/swaps.
      res.setHeader(COLLECTION_REVISION_HEADER, revisionOf(data));
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: "Verlofaanvragen laden is mislukt." });
    }
  });

  // Bezetting van de verlofkalender per dag, zonder personen (elke rol mag
  // lezen). GET /api/leave geeft een chauffeur bewust enkel eigen verlof
  // (privacy), maar daardoor rekende zijn kalender de bezetting op een lege
  // lijst: elke dag "Vrij", en de limietwaarschuwing bij het aanvragen kwam
  // nooit. Dit endpoint geeft uitsluitend datum + aantal + limiet terug, met
  // exact dezelfde telregels als de planner-kant (teltInVerlofbezetting:
  // rijdend personeel zonder flexi's; alleen goedgekeurd; ziekte telt niet).
  app.get("/api/leave/bezetting", authenticate, async (req: AuthenticatedRequest, res) => {
    try {
      // Echte kalendercheck, zelfde reden als bij de ziekmelding: "2026-02-31"
      // past in de regex maar bestaat niet.
      const isoDay = (v: unknown): string | null => {
        if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
        const d = new Date(`${v}T00:00:00Z`);
        return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v ? v : null;
      };
      const van = isoDay(req.query.van);
      const tot = isoDay(req.query.tot);
      if (!van || !tot || tot < van) {
        return res.status(400).json({ error: "Geef een geldige periode op (?van=JJJJ-MM-DD&tot=JJJJ-MM-DD)." });
      }
      // Zelfde grens als dagenVan aan de client-kant: ruim genoeg voor een
      // kalenderjaar, en geen antwoord van duizenden rijen op een tikfout.
      const start = new Date(`${van}T00:00:00Z`);
      const eind = new Date(`${tot}T00:00:00Z`);
      if ((eind.getTime() - start.getTime()) / 86400000 >= 400) {
        return res.status(400).json({ error: "Periode te lang: vraag hoogstens 400 dagen op." });
      }

      const [leave, users] = await Promise.all([getLeaveData(), getUsersData()]);
      // Verloflimieten zoals GET /api/verlof/limieten: zonder instellingen-tabel
      // (of bij een DB-hik) de standaard, de kalender moet blijven werken.
      let limieten = parseVerlofLimieten(null);
      try {
        limieten = parseVerlofLimieten(await getAppSetting(VERLOF_LIMIETEN_KEY));
      } catch (err: any) {
        if (!isMissingTableError(err)) console.error("Verloflimieten laden is mislukt.", err);
      }
      // Zelfde regels als bezettingOp/anderenAfwezigOp aan de client-kant:
      // goedgekeurd, geen ziekte, en de aanvrager telt in de verlofbezetting
      // (een onbekende aanvrager telt mee, net als daar). De telling zelf staat
      // in shared/verlofbezettingPerDag.ts, want ook het rapport
      // "Verlofbezetting per dag" gebruikt ze. Hier gaan BEWUST alleen datum,
      // aantal en limiet naar buiten: elke rol mag dit lezen, namen niet.
      const dagen = bezettingPerDag({ leave, users, van, tot, limietVoor: (dag) => limietVoorDag(limieten, dag) })
        .map(({ datum, aantal, limiet }) => ({ datum, aantal, limiet }));
      res.json({ dagen });
    } catch (err) {
      console.error("Verlofbezetting laden is mislukt.", err);
      res.status(500).json({ error: "Verlofbezetting laden is mislukt." });
    }
  });

  app.post("/api/leave/sick-report", authenticate, requireRole("planner", "admin"), async (req: AuthenticatedRequest, res) => {
    try {
      const uit = await registreerZiekmeldingIntern(
        { userId: req.body?.userId, startDate: req.body?.startDate, endDate: req.body?.endDate, comment: req.body?.comment },
        { id: String(req.appUser!.id), name: req.appUser!.name || "Planning", role: req.appUser!.role as "planner" | "admin" },
      );
      if ("fout" in uit) return res.status(uit.fout.status).json({ error: uit.fout.error });
      res.setHeader(COLLECTION_REVISION_HEADER, revisionOf(await getLeaveData()));
      res.json({ success: true, leave: uit.leave });
    } catch (err) {
      console.error("Ziekmelding mislukt:", err);
      res.status(500).json({ error: "Ziekmelding is mislukt." });
    }
  });

  app.post("/api/leave", authenticate, async (req: AuthenticatedRequest, res) => {
    try {
      const newData = req.body;
      if (!Array.isArray(newData)) {
        res.status(400).json({ error: "Ongeldig formaat: lijst verwacht." });
        return;
      }

      const previousLeave = await getLeaveData();
      // Planner/admin-payload is gezaghebbend ("ontbreekt = verwijderen"):
      // revisie-check + wipe-detectie zodat een stale save geen verse aanvraag
      // stilletjes verwijdert. Chauffeur-payloads worden delta-gereconstrueerd.
      if (isStafRol(req.appUser!.role)) {
        { const rp = revisionCheck(req, previousLeave); if (rp) return revisionProbleemResponse(res, "De verlofaanvragen", rp); }
        const leaveRemoved = detectMassDelete(previousLeave, newData);
        if (leaveRemoved !== null) return massDeleteResponse(res, leaveRemoved, previousLeave.length, "verlofaanvragen");
      }
      const previousById = new Map(previousLeave.map((r) => [r.id, r]));
      const users = await getUsersData();
      const userName = (id: string) => users.find((u) => String(u.id) === String(id))?.name || `Onbekende gebruiker (${id})`;
      const formatLeaveType = (t: string) => LEAVE_TYPE_LABEL[t] ?? t;

      // Server-side autorisatie: chauffeurs kunnen alleen eigen pending-aanvragen
      // toevoegen of intrekken. Status-overgangen en bewerken van anderen vereist
      // planner/admin.
      const payloadLeaveIds = new Set(newData.map((r: any) => String(r.id)));
      const leaveIdsToDelete: string[] = [];
      // Wat er werkelijk weggeschreven wordt. Planner/admin schrijven de hele
      // payload (vertrouwde rol); voor een chauffeur bouwen we — net als bij
      // /api/swaps — enkel de records op die hij/zij legitiem toevoegt, en
      // droppen we echo's van bestaande records. Zo geeft een stale echo geen
      // vals 403 en overschrijft hij nooit een gelijktijdige planner-beslissing
      // (TOCTOU-clobber).
      let recordsToWrite: any[] = newData;

      if (!isStafRol(req.appUser!.role)) {
        const newById = new Map(newData.map((r: any) => [String(r.id), r]));
        const selfId = String(req.appUser.id);

        for (const [id, prev] of previousById) {
          if (!newById.has(String(id))) {
            // GET /api/leave is voor chauffeurs gescoped op eigen records:
            // verlof van collega's zit dus nooit in hun payload en mag hier
            // niet als 'intrekking' gelden — anders krijgt elke chauffeur
            // 403 zodra een collega ook maar één verlofrecord heeft.
            if (String(prev.userId) !== selfId) continue;
            // Alleen eigen pending-aanvragen die de chauffeur weglaat = intrekking.
            // Een weggelaten al-besliste eigen aanvraag (bv. stale sessie)
            // negeren we bewust i.p.v. 403 — beslissen doet de chauffeur toch niet.
            if (prev.status === "pending") leaveIdsToDelete.push(String(id));
          }
        }

        const chauffeurWrites: any[] = [];
        for (const next of newData) {
          // Echo van een bestaand record wordt NOOIT (her)geschreven: chauffeurs
          // mochten bestaande aanvragen sowieso niet bewerken. Enkel écht nieuwe.
          if (previousById.has(String(next.id))) continue;
          if (String(next.userId) !== selfId) {
            return res.status(403).json({ error: "Niet toegestaan: je kan alleen voor jezelf verlof aanvragen." });
          }
          if (next.status !== "pending") {
            return res.status(403).json({ error: "Niet toegestaan: nieuwe verlofaanvragen starten als 'pending'." });
          }
          if (!RECORD_ID_RE.test(String(next.id ?? ""))) {
            return res.status(400).json({ error: "Ongeldig aanvraag-id." });
          }
          if (next.decidedAt) {
            return res.status(403).json({ error: "Niet toegestaan: nieuwe aanvraag mag geen beslismoment hebben." });
          }
          chauffeurWrites.push(next);
        }
        recordsToWrite = chauffeurWrites;
      } else {
        // Planner/admin: alles wat uit de (volledige) payload is weggelaten is
        // een bewuste verwijdering door een vertrouwde rol.
        for (const [id] of previousById) {
          if (!payloadLeaveIds.has(String(id))) leaveIdsToDelete.push(String(id));
        }
      }

      // State-machine (zelfde regel als de PATCH-route en de swaps-array-route):
      // een afgewezen of geannuleerde aanvraag is een eindstation. Zonder deze
      // guard kon een planner-save (of stale client) rejected → approved zetten,
      // mét goedkeuringsmail, zonder dat iemand het als heropening herkende.
      // approved → cancelled blijft toegestaan ("Verlof annuleren").
      for (const next of recordsToWrite) {
        const prev = previousById.get(String(next.id));
        if (prev && String(next.status) !== String(prev.status) && ["rejected", "cancelled"].includes(String(prev.status))) {
          return res.status(409).json({ error: "Deze verlofaanvraag is al afgehandeld en kan niet meer van status veranderen." });
        }
      }

      // Domeinvalidatie (álle rollen, óók op gewijzigde bestaande records):
      // alle afgeleide logica (bezetting, conflictdetectie, agenda-feed)
      // vergelijkt datums als strings — één kapotte datum maakt een aanvraag
      // daar stil onzichtbaar terwijl hij wél goedgekeurd blijft. Voorheen
      // sloeg deze lus bestaande records over (`previousById.has → continue`),
      // zodat een planner-save de periode van bestaand verlof onbewaakt kon
      // verzetten. Ongewijzigde records overslaan blijft (idempotente echo's,
      // en oude records met een verouderd formaat mogen niet retro-falen).
      const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
      const ongewijzigd = (a: any, b: any) =>
        a && String(a.startDate) === String(b.startDate) &&
        String(a.endDate) === String(b.endDate) &&
        String(a.type) === String(b.type);
      for (const next of recordsToWrite) {
        const prev = previousById.get(String(next.id));
        if (prev && ongewijzigd(prev, next)) continue;
        const start = String(next.startDate ?? "");
        const end = String(next.endDate ?? "");
        if (!ISO_DAY.test(start) || !ISO_DAY.test(end)) {
          return res.status(400).json({ error: "Ongeldige datum in de aanvraag: verwacht JJJJ-MM-DD." });
        }
        if (end < start) {
          return res.status(400).json({ error: "De einddatum ligt vóór de startdatum." });
        }
        if (!LEAVE_TYPE_LABEL[String(next.type ?? "")]) {
          return res.status(400).json({ error: "Ongeldig verloftype." });
        }
      }

      await saveLeaveData(recordsToWrite, leaveIdsToDelete, { alleenPending: !isStafRol(req.appUser!.role) });

      if (leaveIdsToDelete.length > 0) {
        await logActivity(
          req,
          "leave",
          "Verlof ingetrokken",
          `${leaveIdsToDelete.length} verlofaanvra${leaveIdsToDelete.length === 1 ? "ag" : "gen"} ingetrokken/verwijderd.`,
        );
      }

      for (const next of recordsToWrite) {
        const prev = previousById.get(next.id);
        const period = PERIODE_DMJ(next.startDate, next.endDate);
        const typeLabel = formatLeaveType(next.type);

        if (!prev) {
          // Planner/admin die verlof namens een chauffeur vastlegt (mondeling
          // doorgegeven, of de papieren goedkeuringen overzetten, Jarno 09-09):
          // dat is geen aanvraag maar een registratie, meteen goedgekeurd. Zo
          // heet het ook in het activiteitenlog, en er gaat geen "je verlof is
          // goedgekeurd"-mail uit: de chauffeur wist dat al.
          const geregistreerd = isStafRol(req.appUser!.role) && String(next.status) === "approved";
          await logActivity(
            req,
            "leave",
            geregistreerd ? "Verlof geregistreerd" : "Verlof aangevraagd",
            geregistreerd
              ? `${userName(next.userId)}: ${typeLabel} voor ${period} vastgelegd door ${req.appUser?.name || "Planning"}, meteen goedgekeurd.`
              : `${userName(next.userId)} vroeg ${typeLabel} aan voor ${period}.`,
            { type: "leave", id: next.id },
          );
          // Nieuwe aanvraag van een chauffeur → seintje naar planners/admins,
          // en dezelfde melding mét goedkeurknoppen naar de Telegram-chat.
          if (!isStafRol(req.appUser!.role)) {
            const beslissers = users.filter(isActieveStaf).map((u) => String(u.id));
            await sendPushToUsers(beslissers, {
              title: "Nieuwe verlofaanvraag",
              soort: "verlof",
              body: `${userName(next.userId)} vroeg ${typeLabel} aan voor ${period}.`,
              url: viewUrl("verlof"),
            });
            await meldVerlofAanvraagTelegram({ id: String(next.id), naam: userName(next.userId), typeLabel, start: String(next.startDate), eind: String(next.endDate) });
          }
          continue;
        }

        if (prev.status !== next.status && next.status !== "pending") {
          let action: string | null = null;
          let emailAction: LeaveDecisionAction | null = null;
          if (next.status === "approved") { action = "Verlof goedgekeurd"; emailAction = "approved"; }
          else if (next.status === "rejected") { action = "Verlof afgewezen"; emailAction = "rejected"; }
          else if (next.status === "cancelled") { action = "Verlof geannuleerd"; emailAction = "cancelled"; }
          if (!action) continue;
          await logActivity(
            req,
            "leave",
            action,
            `${userName(next.userId)}, ${typeLabel} (${period}).`,
            { type: "leave", id: next.id },
          );

          // E-mail + push naar de aanvrager — niet de actor zelf (geen mail
          // naar jezelf als planner/admin je eigen verlof beslist).
          if (emailAction && req.appUser && String(req.appUser.id) !== String(next.userId)) {
            const recipient = users.find((u) => String(u.id) === String(next.userId));
            if (recipient?.email) {
              await sendLeaveDecisionEmail({
                to: recipient.email,
                recipientName: recipient.name,
                decidedByName: req.appUser.name || "Planning",
                typeLabel,
                startDate: next.startDate,
                endDate: next.endDate,
                action: emailAction,
              });
            }
            await sendPushToUsers([String(next.userId)], {
              title: action,
              soort: "verlof",
              body: `${typeLabel} (${period}), beslist door ${req.appUser.name || "Planning"}.`,
              url: viewUrl("verlof"),
            });
          }
        }
      }

      // Verse revisie (zie /api/swaps).
      res.setHeader(COLLECTION_REVISION_HEADER, revisionOf(await getLeaveData()));
      res.json({ success: true });
    } catch (err: any) {
      console.error("Verlofaanvraag opslaan is mislukt.", err);
      res.status(500).json({ error: "Verlofaanvraag opslaan is mislukt." });
    }
  });

  app.patch("/api/leave/:id", authenticate, requireRole("planner", "admin"), async (req: AuthenticatedRequest, res) => {
    try {
      const id = String(req.params.id);
      const status = String(req.body?.status ?? "");
      // Verplicht, net als bij swaps: zonder ifStatus is er géén concurrency-
      // guard en geldt stil last-write-wins — het gat dat deze route moest
      // dichten (#251 beloofde dit voor beide routes; leave was vergeten).
      const ifStatus = req.body?.ifStatus ? String(req.body.ifStatus) : null;
      if (!ifStatus) {
        return res.status(400).json({ error: "ifStatus ontbreekt: stuur de status waarop je beslissing gebaseerd is mee." });
      }
      const uit = await beslisVerlofIntern({
        id,
        status,
        ifStatus,
        actor: { id: String(req.appUser!.id), name: req.appUser!.name || "Planning", role: req.appUser!.role as "planner" | "admin" },
      });
      if ("fout" in uit) {
        return res.status(uit.fout.status).json({ error: uit.fout.error, ...(uit.fout.currentStatus ? { currentStatus: uit.fout.currentStatus } : {}) });
      }

      // Verse collectie-revisie (zie /api/swaps PATCH).
      res.setHeader(COLLECTION_REVISION_HEADER, revisionOf(await getLeaveData()));
      res.json({ success: true, leave: uit.leave });
    } catch (err: any) {
      console.error("Beslissing opslaan is mislukt", err);
      res.status(500).json({ error: "Beslissing opslaan is mislukt" });
    }
  });
}
