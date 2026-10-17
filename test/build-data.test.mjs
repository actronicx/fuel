import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { build, parseCsv, isoDay, tileKey } from "../scripts/build-data.mjs";

// I file in test/fixtures sono DATI DI PROVA inventati, nel formato MIMIT dal 10/02/2026 (separatore "|").
const fixture = (f) => readFile(new URL(`fixtures/${f}`, import.meta.url), "utf8");

test("legge intestazione e data di estrazione", async () => {
  const { extraction, rows } = parseCsv(await fixture("prezzi.csv"));
  assert.equal(extraction, "2026-10-16");
  assert.equal(rows[0].idimpianto, "1001");
  assert.equal(rows[0].desccarburante, "Benzina");
});

test("accetta anche il vecchio separatore ;", () => {
  const { rows } = parseCsv("Estrazione del 2025-01-01\nidImpianto;descCarburante;prezzo;isSelf;dtComu\n1;Benzina;1.8;1;01/01/2025 08:00:00\n");
  assert.equal(rows[0].prezzo, "1.8");
});

test("converte le date", () => {
  assert.equal(isoDay("02/10/2026 07:12:00"), "2026-10-02");
  assert.equal(isoDay(""), null);
});

test("unisce anagrafica e prezzi, scarta coordinate e carburanti non validi", async () => {
  const { meta, tiles, comuni } = build(await fixture("anagrafica.csv"), await fixture("prezzi.csv"));
  const all = Object.values(tiles).flat();
  assert.equal(meta.stations, 48);
  assert.ok(!all.some((s) => s.i === 9999), "il distributore con coordinate 0,0 va scartato");
  const s = all.find((s) => s.i === 1001);
  assert.deepEqual(s.f.B, [1.909, 2.059, "2026-10-16"]);
  assert.equal(s.b, "Pompe Bianche");
  assert.equal(s.c, "Roma");
  assert.ok(all.every((s) => Object.keys(s.f).every((k) => "BGLM".includes(k))), "niente Blue Diesel");
  assert.ok(all.every((s) => tiles[tileKey(s.y, s.x)].includes(s)));
  assert.deepEqual(comuni.map((c) => c[0]), ["Fiumicino", "Milano", "Roma"]);
});
