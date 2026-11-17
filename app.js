"use strict";
(function () {
  // Unica fonte dei parametri dello strumento.
  var CONFIG = {
    freeFileLimit: 3,
    csvSeparator: ";",
    csvFileName: "fatture.csv",
    csvHeaders: ["File", "TipoDocumento", "Numero", "Data", "Cedente", "PIVA_CF",
      "Imponibile", "IVA", "Totale"],
    locale: "it-IT"
  };

  // ---------- Parser FatturaPA (nessun I/O) ----------
  function childrenByName(node, name) {
    var out = [];
    for (var i = 0; i < node.children.length; i++) {
      if (node.children[i].localName === name) out.push(node.children[i]);
    }
    return out;
  }

  function descend(node, path) {
    var nodes = [node];
    path.forEach(function (name) {
      var next = [];
      nodes.forEach(function (n) { next = next.concat(childrenByName(n, name)); });
      nodes = next;
    });
    return nodes;
  }

  function text(node, path) {
    var found = descend(node, path);
    return found.length ? found[0].textContent.trim() : "";
  }

  function num(value) {
    var n = parseFloat(value);
    return isFinite(n) ? n : 0;
  }

  function round2(n) { return Math.round(n * 100) / 100; }

  function cedenteName(anag) {
    var den = text(anag, ["Anagrafica", "Denominazione"]);
    if (den) return den;
    return [text(anag, ["Anagrafica", "Nome"]), text(anag, ["Anagrafica", "Cognome"])]
      .filter(Boolean).join(" ");
  }

  function cedenteId(anag) {
    var paese = text(anag, ["IdFiscaleIVA", "IdPaese"]);
    var codice = text(anag, ["IdFiscaleIVA", "IdCodice"]);
    if (codice) return paese + codice;
    return text(anag, ["CodiceFiscale"]);
  }

  function parseBody(body, cedente, fileName) {
    var doc = descend(body, ["DatiGenerali", "DatiGeneraliDocumento"])[0];
    if (!doc) throw new Error("DatiGeneraliDocumento mancante");
    var imponibile = 0, iva = 0;
    descend(body, ["DatiBeniServizi", "DatiRiepilogo"]).forEach(function (r) {
      imponibile += num(text(r, ["ImponibileImporto"]));
      iva += num(text(r, ["Imposta"]));
    });
    var declared = text(doc, ["ImportoTotaleDocumento"]);
    return {
      file: fileName,
      tipo: text(doc, ["TipoDocumento"]),
      numero: text(doc, ["Numero"]),
      data: text(doc, ["Data"]),
      cedente: cedente.name,
      id: cedente.id,
      imponibile: round2(imponibile),
      iva: round2(iva),
      totale: declared ? round2(num(declared)) : round2(imponibile + iva)
    };
  }

  // Restituisce una riga per ogni body (un lotto può contenerne più di uno).
  function parseFattura(xmlText, fileName) {
    var dom = new DOMParser().parseFromString(xmlText, "application/xml");
    if (dom.getElementsByTagName("parsererror").length) throw new Error("XML non valido");
    var root = dom.documentElement;
    if (root.localName !== "FatturaElettronica") throw new Error("Non è una FatturaPA");
    var anag = descend(root, ["FatturaElettronicaHeader", "CedentePrestatore", "DatiAnagrafici"])[0];
    if (!anag) throw new Error("CedentePrestatore mancante");
    var cedente = { name: cedenteName(anag), id: cedenteId(anag) };
    var bodies = childrenByName(root, "FatturaElettronicaBody");
    if (!bodies.length) throw new Error("FatturaElettronicaBody mancante");
    return bodies.map(function (b) { return parseBody(b, cedente, fileName); });
  }

  // ---------- Totali e CSV (puri) ----------
  function computeTotals(rows) {
    var t = { imponibile: 0, iva: 0, totale: 0 };
    rows.forEach(function (r) {
      t.imponibile += r.imponibile; t.iva += r.iva; t.totale += r.totale;
    });
    return { imponibile: round2(t.imponibile), iva: round2(t.iva), totale: round2(t.totale) };
  }

  function formatAmount(n) {
    return n.toLocaleString(CONFIG.locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function csvAmount(n) { return n.toFixed(2).replace(".", ","); }

  function csvText(value) {
    var s = String(value);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // anti formula-injection in Excel
    return csvCell(s);
  }

  function csvCell(s) {
    if (s.indexOf(CONFIG.csvSeparator) >= 0 || /["\r\n]/.test(s)) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  function buildCsv(rows) {
    var lines = [CONFIG.csvHeaders.join(CONFIG.csvSeparator)];
    rows.forEach(function (r) {
      lines.push([csvText(r.file), csvText(r.tipo), csvText(r.numero), csvText(r.data),
        csvText(r.cedente), csvText(r.id),
        csvAmount(r.imponibile), csvAmount(r.iva), csvAmount(r.totale)].join(CONFIG.csvSeparator));
    });
    return "﻿" + lines.join("\r\n") + "\r\n";
  }

  // ---------- Fattura di esempio (FatturaPA v1.2, dati fittizi) ----------
  var SAMPLE_FILE_NAME = "fattura-esempio.xml";
  var SAMPLE_XML = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<p:FatturaElettronica versione="FPR12" xmlns:p="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2">',
    '<FatturaElettronicaHeader>',
    '<DatiTrasmissione><IdTrasmittente><IdPaese>IT</IdPaese><IdCodice>01234567890</IdCodice></IdTrasmittente>',
    '<ProgressivoInvio>00001</ProgressivoInvio><FormatoTrasmissione>FPR12</FormatoTrasmissione>',
    '<CodiceDestinatario>0000000</CodiceDestinatario></DatiTrasmissione>',
    '<CedentePrestatore><DatiAnagrafici><IdFiscaleIVA><IdPaese>IT</IdPaese><IdCodice>01234567890</IdCodice></IdFiscaleIVA>',
    '<Anagrafica><Denominazione>Rossi Servizi S.r.l. (esempio)</Denominazione></Anagrafica>',
    '<RegimeFiscale>RF01</RegimeFiscale></DatiAnagrafici>',
    '<Sede><Indirizzo>Via Roma 1</Indirizzo><CAP>00100</CAP><Comune>Roma</Comune><Provincia>RM</Provincia><Nazione>IT</Nazione></Sede>',
    '</CedentePrestatore>',
    '<CessionarioCommittente><DatiAnagrafici><CodiceFiscale>RSSMRA80A01H501U</CodiceFiscale>',
    '<Anagrafica><Nome>Mario</Nome><Cognome>Bianchi</Cognome></Anagrafica></DatiAnagrafici>',
    '<Sede><Indirizzo>Via Milano 2</Indirizzo><CAP>20100</CAP><Comune>Milano</Comune><Provincia>MI</Provincia><Nazione>IT</Nazione></Sede>',
    '</CessionarioCommittente>',
    '</FatturaElettronicaHeader>',
    '<FatturaElettronicaBody>',
    '<DatiGenerali><DatiGeneraliDocumento><TipoDocumento>TD01</TipoDocumento><Divisa>EUR</Divisa>',
    '<Data>2026-01-15</Data><Numero>1/2026</Numero><ImportoTotaleDocumento>1220.00</ImportoTotaleDocumento>',
    '</DatiGeneraliDocumento></DatiGenerali>',
    '<DatiBeniServizi><DettaglioLinee><NumeroLinea>1</NumeroLinea><Descrizione>Consulenza (esempio)</Descrizione>',
    '<Quantita>10.00</Quantita><PrezzoUnitario>100.00</PrezzoUnitario><PrezzoTotale>1000.00</PrezzoTotale>',
    '<AliquotaIVA>22.00</AliquotaIVA></DettaglioLinee>',
    '<DatiRiepilogo><AliquotaIVA>22.00</AliquotaIVA><ImponibileImporto>1000.00</ImponibileImporto>',
    '<Imposta>220.00</Imposta><EsigibilitaIVA>I</EsigibilitaIVA></DatiRiepilogo></DatiBeniServizi>',
    '</FatturaElettronicaBody>',
    '</p:FatturaElettronica>'
  ].join("");

  // ---------- UI ----------
  var state = { rows: [], accepted: 0 };
  var $ = function (id) { return document.getElementById(id); };

  function cell(tr, value, cls) {
    var td = document.createElement("td");
    td.textContent = value;
    if (cls) td.className = cls;
    tr.appendChild(td);
  }

  function render() {
    var tbody = $("rows");
    tbody.textContent = "";
    state.rows.forEach(function (r) {
      var tr = document.createElement("tr");
      [r.file, r.tipo, r.numero, r.data].forEach(function (v) { cell(tr, v); });
      cell(tr, r.cedente, "cedente");
      cell(tr, r.id);
      cell(tr, formatAmount(r.imponibile), "num");
      cell(tr, formatAmount(r.iva), "num");
      cell(tr, formatAmount(r.totale), "num");
      tbody.appendChild(tr);
    });
    var t = computeTotals(state.rows);
    $("tot-imponibile").textContent = formatAmount(t.imponibile);
    $("tot-iva").textContent = formatAmount(t.iva);
    $("tot-totale").textContent = formatAmount(t.totale);
    $("count").textContent = String(state.rows.length);
    $("results").hidden = state.rows.length === 0;
  }

  function addError(msg) {
    var li = document.createElement("li");
    li.textContent = msg;
    $("errors").appendChild(li);
  }

  function readFile(file) {
    if (file.text) return file.text();
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(String(fr.result)); };
      fr.onerror = function () { reject(fr.error); };
      fr.readAsText(file);
    });
  }

  function handleFiles(fileList) {
    var files = Array.prototype.slice.call(fileList);
    var slots = Math.max(0, CONFIG.freeFileLimit - state.accepted);
    var allowed = files.slice(0, slots);
    $("banner").hidden = files.length <= slots;
    $("errors").textContent = "";
    state.accepted += allowed.length;
    Promise.all(allowed.map(function (f) {
      return readFile(f).then(function (xml) {
        state.rows = state.rows.concat(parseFattura(xml, f.name));
      }).catch(function (e) {
        addError(f.name + ": " + (e && e.message ? e.message : "errore di lettura"));
      });
    })).then(render);
  }

  // Carica la fattura di esempio senza consumare il limite Free.
  function loadSampleInvoice() {
    $("errors").textContent = "";
    try {
      var rows = parseFattura(SAMPLE_XML, SAMPLE_FILE_NAME);
      state.rows = state.rows.filter(function (r) { return r.file !== SAMPLE_FILE_NAME; }).concat(rows);
    } catch (e) {
      addError("Fattura di esempio: " + (e && e.message ? e.message : "errore"));
    }
    render();
    $("results").scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function exportCsv() {
    var blob = new Blob([buildCsv(state.rows)], { type: "text/csv;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = CONFIG.csvFileName;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function clearAll() {
    state.rows = []; state.accepted = 0;
    $("banner").hidden = true; $("errors").textContent = "";
    render();
  }

  function init() {
    var zone = $("dropzone"), input = $("file-input");
    $("free-limit").textContent = String(CONFIG.freeFileLimit);
    zone.addEventListener("click", function () { input.click(); });
    zone.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); }
    });
    input.addEventListener("change", function () { handleFiles(input.files); input.value = ""; });
    ["dragenter", "dragover"].forEach(function (ev) {
      zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.add("dragover"); });
    });
    ["dragleave", "drop"].forEach(function (ev) {
      zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.remove("dragover"); });
    });
    zone.addEventListener("drop", function (e) { handleFiles(e.dataTransfer.files); });
    $("sample").addEventListener("click", loadSampleInvoice);
    $("export").addEventListener("click", exportCsv);
    $("clear").addEventListener("click", clearAll);
    if (typeof location !== "undefined" && location.search.indexOf("demo=1") !== -1) loadSampleInvoice();
  }

  if (typeof document !== "undefined" && document.getElementById("dropzone")) init();
  if (typeof module !== "undefined") module.exports = { parseFattura: parseFattura, buildCsv: buildCsv, computeTotals: computeTotals, SAMPLE_XML: SAMPLE_XML };
})();
