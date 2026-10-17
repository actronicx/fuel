#!/usr/bin/env node
// Scarica gli open data MIMIT sui carburanti e li trasforma in file JSON
// piccoli, divisi in "caselle" geografiche da 0,5°, che l'app carica solo
// per la zona dell'utente.
//
// Uso:
//   node scripts/build-data.mjs --out public/data
//   node scripts/build-data.mjs --out /tmp/data --anagrafica a.csv --prezzi p.csv   (file locali)
//   node scripts/build-data.mjs --out public/data --cartella fonte   (file caricati a mano)

import { mkdir, readFile, readdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";

const SOURCES = {
  anagrafica: "https://www.mimit.gov.it/images/exportCSV/anagrafica_impianti_attivi.csv",
  prezzi: "https://www.mimit.gov.it/images/exportCSV/prezzo_alle_8.csv",
};

// Carburanti mostrati nell'app: chiave breve -> nome esatto nel file MIMIT.
// Le varianti "premium" (Blue Diesel, HiQ, ecc.) sono escluse di proposito.
export const FUELS = { B: "benzina", G: "gasolio", L: "gpl", M: "metano" };

export const TILE = 0.5; // gradi
export const tileKey = (lat, lon) => `${Math.floor(lat / TILE)}_${Math.floor(lon / TILE)}`;

// Riquadro largo attorno all'Italia: scarta coordinate assenti o sbagliate.
const inItaly = (lat, lon) => lat > 35 && lat < 47.6 && lon > 6 && lon < 19;

export function parseCsv(text) {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  // La prima riga è "Estrazione del AAAA-MM-GG"; l'intestazione è quella con idImpianto.
  const h = lines.findIndex((l) => /idimpianto/i.test(l));
  if (h < 0) throw new Error("Intestazione con idImpianto non trovata");
  const sep = lines[h].includes("|") ? "|" : ";";
  const header = lines[h].split(sep).map((s) => s.trim().toLowerCase());
  const extraction = (lines.slice(0, h).join(" ").match(/\d{4}-\d{2}-\d{2}/) || [])[0] || null;
  const rows = [];
  for (const line of lines.slice(h + 1)) {
    const cells = line.split(sep);
    if (cells.length < header.length) continue;
    const row = {};
    header.forEach((k, i) => (row[k] = (cells[i] ?? "").trim()));
    rows.push(row);
  }
  return { extraction, rows };
}

const num = (s) => parseFloat(String(s).replace(",", "."));

// "16/10/2026 07:12:33" -> "2026-10-16"
export function isoDay(s) {
  const m = String(s).match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

const titleCase = (s) =>
  s.toLowerCase().replace(/(^|[\s'’\-\/(])(\p{L})/gu, (_, a, b) => a + b.toUpperCase());

export function build(anagraficaText, prezziText) {
  const ana = parseCsv(anagraficaText);
  const pre = parseCsv(prezziText);

  const stations = new Map();
  for (const r of ana.rows) {
    const lat = num(r.latitudine), lon = num(r.longitudine);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !inItaly(lat, lon)) continue;
    stations.set(r.idimpianto, {
      i: Number(r.idimpianto),
      b: titleCase(r.bandiera || "Pompa bianca"),
      a: titleCase(r.indirizzo || ""),
      c: titleCase(r.comune || ""),
      p: (r.provincia || "").toUpperCase(),
      y: Math.round(lat * 1e5) / 1e5,
      x: Math.round(lon * 1e5) / 1e5,
      f: {},
    });
  }

  const fuelByName = Object.fromEntries(Object.entries(FUELS).map(([k, v]) => [v, k]));
  for (const r of pre.rows) {
    const s = stations.get(r.idimpianto);
    const k = fuelByName[(r.desccarburante || "").trim().toLowerCase()];
    const price = num(r.prezzo);
    if (!s || !k || !(price > 0.3 && price < 5)) continue;
    // f[k] = [self, servito, data comunicazione più recente]
    const slot = (s.f[k] ||= [null, null, null]);
    const idx = r.isself === "1" ? 0 : 1;
    if (slot[idx] === null) slot[idx] = Math.round(price * 1000) / 1000;
    const day = isoDay(r.dtcomu);
    if (day && (!slot[2] || day > slot[2])) slot[2] = day;
  }

  // Scarta i prezzi lontanissimi dalla mediana nazionale (errori di battitura dei gestori),
  // che altrimenti finirebbero in cima come "miglior scelta".
  const values = {};
  for (const s of stations.values())
    for (const [k, slot] of Object.entries(s.f))
      for (const i of [0, 1]) if (slot[i] !== null) (values[k + i] ||= []).push(slot[i]);
  const median = {};
  for (const [k, v] of Object.entries(values)) median[k] = v.sort((a, b) => a - b)[Math.floor(v.length / 2)];
  for (const s of stations.values())
    for (const [k, slot] of Object.entries(s.f)) {
      for (const i of [0, 1]) {
        const m = median[k + i];
        if (slot[i] !== null && (slot[i] < m * 0.7 || slot[i] > m * 1.5)) slot[i] = null;
      }
      if (slot[0] === null && slot[1] === null) delete s.f[k];
    }

  const tiles = {};
  const comuni = new Map();
  for (const s of stations.values()) {
    if (!Object.keys(s.f).length) continue;
    (tiles[tileKey(s.y, s.x)] ||= []).push(s);
    const ck = `${s.c}|${s.p}`;
    const c = comuni.get(ck) || { n: s.c, p: s.p, y: 0, x: 0, k: 0 };
    c.y += s.y; c.x += s.x; c.k++;
    comuni.set(ck, c);
  }

  const comuniList = [...comuni.values()]
    .map((c) => [c.n, c.p, Math.round((c.y / c.k) * 1e4) / 1e4, Math.round((c.x / c.k) * 1e4) / 1e4])
    .sort((a, b) => a[0].localeCompare(b[0], "it"));

  const count = Object.values(tiles).reduce((n, t) => n + t.length, 0);
  const meta = {
    extraction: pre.extraction || ana.extraction,
    generated: new Date().toISOString(),
    stations: count,
    tile: TILE,
    tiles: Object.keys(tiles).sort(),
  };
  return { meta, tiles, comuni: comuniList };
}

async function download(url) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "pieno-app-data-builder" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      const why = [e.message, e.cause?.code, e.cause?.message].filter(Boolean).join(" / ");
      if (attempt >= 4) throw new Error(`Download fallito ${url}: ${why}`);
      await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
    }
  }
}

// Cerca nella cartella i due file MIMIT riconoscendoli dal contenuto, non dal nome:
// scaricati dal telefono possono chiamarsi "prezzo_alle_8 (1).csv" e simili.
// Se ce ne sono più versioni usa la più recente (riga "Estrazione del ...").
export async function pickFromFolder(dir) {
  const found = {};
  for (const name of await readdir(dir)) {
    if (!name.toLowerCase().endsWith(".csv")) continue;
    const text = await readFile(path.join(dir, name), "utf8");
    const head = text.slice(0, 400).toLowerCase();
    const kind = head.includes("desccarburante") ? "prezzi" : head.includes("latitudine") ? "anagrafica" : null;
    if (!kind) continue;
    const day = (head.match(/\d{4}-\d{2}-\d{2}/) || [""])[0];
    if (!found[kind] || day > found[kind].day) found[kind] = { name, day, text };
  }
  for (const k of ["anagrafica", "prezzi"])
    if (!found[k]) throw new Error(`Nella cartella ${dir} manca il file ${k === "prezzi" ? "prezzo_alle_8.csv" : "anagrafica_impianti_attivi.csv"}`);
  console.log(`Uso ${found.anagrafica.name} (${found.anagrafica.day}) e ${found.prezzi.name} (${found.prezzi.day})`);
  return found;
}

async function main() {
  const args = Object.fromEntries(
    process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), [])
  );
  const out = args.out || "public/data";
  if (args.cartella) {
    const f = await pickFromFolder(args.cartella);
    args.anagraficaText = f.anagrafica.text;
    args.prezziText = f.prezzi.text;
  }
  const [anaText, preText] = args.anagraficaText ? [args.anagraficaText, args.prezziText] : await Promise.all([
    args.anagrafica ? readFile(args.anagrafica, "utf8") : download(SOURCES.anagrafica),
    args.prezzi ? readFile(args.prezzi, "utf8") : download(SOURCES.prezzi),
  ]);
  const { meta, tiles, comuni } = build(anaText, preText);
  // Protezione: se i dati sono quasi vuoti meglio fallire e lasciare online la versione precedente.
  const min = Number(args["min-stations"] ?? 1000);
  if (meta.stations < min) throw new Error(`Solo ${meta.stations} distributori validi (minimo ${min})`);

  await rm(out, { recursive: true, force: true });
  await mkdir(path.join(out, "t"), { recursive: true });
  await Promise.all([
    writeFile(path.join(out, "meta.json"), JSON.stringify(meta)),
    writeFile(path.join(out, "comuni.json"), JSON.stringify(comuni)),
    ...Object.entries(tiles).map(([k, list]) => writeFile(path.join(out, "t", `${k}.json`), JSON.stringify(list))),
  ]);
  console.log(`Dati del ${meta.extraction}: ${meta.stations} distributori, ${meta.tiles.length} caselle, ${comuni.length} comuni -> ${out}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e.message);
    // Su GitHub Actions l'errore compare anche nel riepilogo dell'esecuzione
    if (process.env.GITHUB_ACTIONS) console.log(`::error::${e.message.replace(/\n/g, " ")}`);
    process.exit(1);
  });
}
