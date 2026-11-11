import { beforeAll, describe, expect, it } from "vitest";
import { addStaff, as, createDb, type Db } from "./harness";

// 0011: the public join questionnaire (payload shape copied from the live page, form sayeret-join-2026).
let db: Db;
const id: Record<string, string> = {};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

const base = {
  form: "sayeret-join-2026", version: 1, submitted_at: "2026-11-11T10:00:00.000Z", ref: "whatsapp",
  first_name: "נועם", last_name: "לוי", phone: "054-1112233", email: "Noam@Example.org", region: "גוש דן + השפלה",
  connection: "פלס״ר / פלגה א׳", fallen_name: "", fallen_relation: "", enlist_year: 2015, enlist_month: "אוגוסט",
  last_role: "מ״כ", commander: "", status: ["שכיר/ה"], study_institution: "", study_field: "", study_year: "",
  scholars_interest: false, work_field: "הייטק - פיתוח/תוכנה", work_role: "מפתח בקאנד", work_experience: "3-6 שנים",
  interests: ["מנטורינג אישי"], memorial_fallen: "", memorial_assign: false, personal: [], knows: [], personal_contact: "",
  give: ["משרות לבוגרים"], fundraising: [], volunteer_areas: [], offer: "", idea: "", platforms: ["קבוצות וואטסאפ"], consent: true,
};
const submit = (p: object) => as(db, null, (tx) => tx.query<Row>(`select public.submit_join($1::jsonb) r`, [JSON.stringify(p)]), { keep: true });
const types = async (c: string) => (await db.query<Row>(`select type_code t from public.contact_type_links where contact_id = $1 order by 1`, [c])).rows.map((r) => r.t);

beforeAll(async () => {
  db = await createDb();
  id.coord = await addStaff(db, "coord@x.org", "coordinator");
  id.donorc = await addStaff(db, "donors@x.org", "donor_coordinator");
  await db.query(`insert into public.cohorts (label) values ('אוגוסט 2015')`);
});

describe("join questionnaire", () => {
  it("creates the person with region, cohort, profession, consent and types", async () => {
    expect((await submit(base)).rows[0].r.status).toBe("processed");
    const c = (await db.query<Row>(`select c.*, r.label region, co.label cohort from public.contacts c
      left join public.regions r on r.id = c.region_id left join public.cohorts co on co.id = c.cohort_id where c.phone = '+972541112233'`)).rows[0];
    expect(c).toMatchObject({ first_name: "נועם", last_name: "לוי", email: "noam@example.org", region: "מרכז", cohort: "אוגוסט 2015",
      campaign_consent: true, available_to_help: true, source: "join_form", profession: "מפתח בקאנד · הייטק - פיתוח/תוכנה" });
    expect(await types(c.id)).toEqual(["alumni", "volunteer"]);
    const s = (await db.query<Row>(`select answers, ref from public.join_submissions where contact_id = $1`, [c.id])).rows[0];
    expect(s.answers.interests).toEqual(["מנטורינג אישי"]);
    expect(s.ref).toBe("whatsapp");
    const seen = await as(db, id.coord, (tx) => tx.query(`select 1 from public.join_submissions where contact_id = $1`, [c.id]));
    expect(seen.rows).toHaveLength(1);
    const hidden = await as(db, id.donorc, (tx) => tx.query(`select 1 from public.join_submissions`));
    expect(hidden.rows).toHaveLength(0); // personal answers are care data
  });

  it("a double submit is stored once", async () => {
    expect((await submit(base)).rows[0].r.status).toBe("duplicate");
  });

  it("personal matters open a welfare case and add the matching (sensitive) types", async () => {
    await submit({ ...base, submitted_at: "2026-11-11T11:00:00Z", phone: "0529998877", email: "", connection: "משפחה שכולה",
      fallen_name: "ישראל ישראלי", fallen_relation: "אח/אחות", personal: ["פצוע/ה, לא מוכר/ת", "מתמודד/ת נפשית"], personal_contact: "בערב" });
    const c = (await db.query<Row>(`select id from public.contacts where phone = '+972529998877'`)).rows[0];
    expect(await types(c.id)).toEqual(["bereaved", "support", "volunteer", "wounded"]);
    const k = (await db.query<Row>(`select category, source, priority, message from public.cases where contact_id = $1`, [c.id])).rows[0];
    expect(k).toMatchObject({ category: "welfare", source: "join_form", priority: "high" });
    expect(k.message).not.toMatch(/נפשי/); // the case text does not repeat the sensitive answer
  });

  it("does not overwrite what staff entered", async () => {
    await db.query(`update public.contacts set first_name = 'נועם אבי', region_id = (select id from public.regions where label = 'צפון') where phone = '+972541112233'`);
    await submit({ ...base, submitted_at: "2026-11-12T10:00:00Z", first_name: "שם אחר", region: "ירושלים" });
    const c = (await db.query<Row>(`select c.first_name, r.label region from public.contacts c join public.regions r on r.id = c.region_id where c.phone = '+972541112233'`)).rows[0];
    expect(c).toEqual({ first_name: "נועם אבי", region: "צפון" });
  });

  it("rejects missing name or phone, and keeps only a real JPEG", async () => {
    await expect(submit({ ...base, first_name: "" })).rejects.toThrow(/שם/);
    await expect(submit({ ...base, phone: "123" })).rejects.toThrow(/טלפון/);
    const r = await as(db, null, (tx) => tx.query<Row>(`select public.submit_join($1::jsonb, $2::bytea) r`,
      [JSON.stringify({ ...base, submitted_at: "2026-11-13T10:00:00Z", phone: "0501231234", email: "other@example.org" }), Buffer.from("not a jpeg at all")]), { keep: true });
    expect(r.rows[0].r.status).toBe("processed");
    const p = (await db.query<Row>(`select photo from public.join_submissions js join public.contacts c on c.id = js.contact_id where c.phone = '+972501231234'`)).rows[0];
    expect(p.photo).toBeNull();
  });
});
