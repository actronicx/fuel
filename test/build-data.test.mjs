import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { build, parseCsv, isoDay, tileKey, pickFromFolder } from "../scripts/build-data.mjs";

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

test("scarta i prezzi assurdi (errori di battitura)", async () => {
  const ana = await fixture("anagrafica.csv");
  const pre = (await fixture("prezzi.csv")) + "1002|Gasolio|0.199|0|16/10/2026 07:00:00\n";
  const { tiles } = build(ana, pre);
  const s = Object.values(tiles).flat().find((s) => s.i === 1002);
  assert.equal(s.f.G[1], null, "0,199 €/l va scartato");
  assert.ok(s.f.G[0] > 1.5, "il prezzo self valido resta");
});

test("riconosce i file nella cartella dal contenuto", async () => {
  const f = await pickFromFolder(new URL("fixtures", import.meta.url).pathname);
  assert.equal(f.anagrafica.name, "anagrafica.csv");
  assert.equal(f.prezzi.name, "prezzi.csv");
});

test("ricostruisce le righe con il separatore dentro il nome", () => {
  const { rows } = parseCsv(
    "Estrazione del 2026-10-16\nidImpianto|Gestore|Bandiera|Tipo Impianto|Nome Impianto|Indirizzo|Comune|Provincia|Latitudine|Longitudine\n" +
    "40820|STOIL SIMPLE|Pompe Bianche|Stradale|STOIL SIMPLE | gestori.prezzibenzina.it|STR. PROV.LE 82|ALESSANDRIA|AL|44.917|8.700\n"
  );
  assert.equal(rows[0]["nome impianto"], "STOIL SIMPLE | gestori.prezzibenzina.it");
  assert.equal(rows[0].comune, "ALESSANDRIA");
  assert.equal(rows[0].longitudine, "8.700");
});

test("scarta i distributori con coordinate lontane dal proprio comune", async () => {
  // Un distributore di Milano con le coordinate di Roma
  const ana = (await fixture("anagrafica.csv")) + "8888|G|Q8|Stradale|X|VIA X 1|MILANO|MI|41.90|12.49\n";
  const pre = (await fixture("prezzi.csv")) + "8888|Benzina|1.850|1|16/10/2026 07:00:00\n";
  const { meta, tiles } = build(ana, pre);
  assert.ok(!Object.values(tiles).flat().some((s) => s.i === 8888));
  assert.equal(meta.misplaced, 1);
});
