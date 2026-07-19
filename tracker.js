/* tracker.js — Core Maths Compendium course tracker tool.
   Everything runs client-side: the uploaded workbook is parsed with SheetJS in the
   browser and the PDF report is built with jsPDF. No file is ever sent anywhere.
   The workbook itself carries no logic at all — it's a plain fill-in-the-blanks
   grid (plus one same-row reference so a name only has to be typed once). All the
   scoring, banding, topic mapping and grade estimate are defined in tracker-data.js
   and applied here, at upload time. */

(function () {
  "use strict";

  var RAG = { green: "#1B998B", amber: "#F4A93F", red: "#c0392b", black: "#12233A" };
  var RAG_LABEL = { green: "Mastered", amber: "Partial", red: "Needs work", black: "Not seen" };
  var TOP_N = 10;

  function band(raw) {
    if (raw === null || raw === undefined || raw === "") return "black";
    var v = Number(raw);
    if (isNaN(v)) return "black";
    if (v >= 0.8) return "green";
    if (v >= 0.5) return "amber";
    return "red";
  }

  function pct(v) {
    return v === null || v === undefined || isNaN(v) ? "—" : Math.round(v * 100) + "%";
  }

  function fmtDate(v) {
    if (!v) return "";
    // Use UTC getters (not local-time getters/toLocaleDateString) so the date
    // shown never drifts by a day depending on the browser's timezone, and nudge
    // by 12h first since spreadsheet date serials sometimes round to a few hours
    // either side of midnight after a save/recalculate round-trip.
    if (v instanceof Date) {
      var vv = new Date(v.getTime() + 12 * 60 * 60 * 1000);
      var dd = vv.getUTCDate(), mm = vv.getUTCMonth() + 1, yy = vv.getUTCFullYear();
      return (dd < 10 ? "0" : "") + dd + "/" + (mm < 10 ? "0" : "") + mm + "/" + yy;
    }
    if (typeof v === "number") {
      var d = XLSX.SSF ? XLSX.SSF.parse_date_code(v) : null;
      if (d) return (d.d < 10 ? "0" : "") + d.d + "/" + (d.m < 10 ? "0" : "") + d.m + "/" + d.y;
    }
    return String(v);
  }

  // ---------- workbook parsing ----------
  // Reads raw marks straight off each plain test sheet (no scoring formulas or
  // lookups involved beyond the one same-row name reference) and works out every
  // student's per-topic average itself, using the question -> subskill map in
  // tracker-data.js. Also reads the Class list sheet for form / date of birth.

  function parseWorkbook(wb) {
    var spec = window.TRACKER_SPEC || [];
    var subskillList = window.SUBSKILLS || [];
    var specByName = {};
    spec.forEach(function (s) { specByName[s.sheet] = s; });

    var meta = {}; // name (lowercase) -> {form, dob}
    var classListSheet = wb.SheetNames.filter(function (n) { return /class list/i.test(n); })[0];
    if (classListSheet) {
      var clGrid = XLSX.utils.sheet_to_json(wb.Sheets[classListSheet], { header: 1, raw: true, defval: "" });
      var clHeaderIdx = -1;
      for (var hi = 0; hi < clGrid.length; hi++) {
        if (String(clGrid[hi][0]).trim() === "Pupil name") { clHeaderIdx = hi; break; }
      }
      if (clHeaderIdx !== -1) {
        for (var cr = clHeaderIdx + 1; cr < clGrid.length; cr++) {
          var crow = clGrid[cr];
          if (!crow) continue;
          var cname = String(crow[0] || "").trim();
          if (!cname) continue;
          meta[cname.toLowerCase()] = { form: String(crow[1] || "").trim(), dob: fmtDate(crow[2]) };
        }
      }
    }

    var studentMap = {};
    var matchedAnySheet = false;

    wb.SheetNames.forEach(function (sheetName) {
      var specEntry = specByName[sheetName];
      if (!specEntry) return;
      var ws = wb.Sheets[sheetName];
      var grid = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" });

      var headerRowIdx = -1;
      for (var i = 0; i < grid.length; i++) {
        if (String(grid[i][0]).trim() === "Pupil name") { headerRowIdx = i; break; }
      }
      if (headerRowIdx === -1) return;
      matchedAnySheet = true;
      var dataStart = headerRowIdx + 2; // row after "Pupil name" header is "Max marks" — skip it

      for (var r = dataStart; r < grid.length; r++) {
        var row = grid[r];
        if (!row) continue;
        var name = String(row[0] || "").trim();
        if (!name) continue;
        var key = name.toLowerCase();
        if (!studentMap[key]) studentMap[key] = { name: name, subskills: {} };

        specEntry.questions.forEach(function (q, qi) {
          var raw = row[1 + qi];
          if (raw === "" || raw === undefined || raw === null) return; // left blank — not attempted
          var num = Number(raw);
          if (isNaN(num) || !q.subskill) return;
          var frac = q.maxMarks ? num / q.maxMarks : 0;
          frac = Math.max(0, Math.min(1, frac));
          if (!studentMap[key].subskills[q.subskill]) studentMap[key].subskills[q.subskill] = [];
          studentMap[key].subskills[q.subskill].push(frac);
        });
      }
    });

    if (!matchedAnySheet) {
      throw new Error("Couldn't find any recognised test sheets in this file. Please upload the tracker workbook you downloaded from this page, with some marks filled in.");
    }

    var students = Object.keys(studentMap).map(function (key) {
      var s = studentMap[key];
      var topics = subskillList.map(function (sc) {
        var arr = s.subskills[sc.code];
        var value = null;
        if (arr && arr.length) value = arr.reduce(function (a, b) { return a + b; }, 0) / arr.length;
        return { code: sc.code, desc: sc.desc, value: value, band: band(value === null ? "" : value) };
      });
      var m = meta[key] || { form: "", dob: "" };
      return { name: s.name, form: m.form, dob: m.dob, topics: topics };
    });

    if (!students.length) {
      throw new Error("No pupil names were found. Type each pupil's name in the 'Pupil name' column on at least one sheet, with at least one mark filled in, then upload again.");
    }
    students.sort(function (a, b) { return a.name.localeCompare(b.name); });
    return { subskillCols: subskillList, students: students };
  }

  // ---------- analysis ----------

  function summariseTopics(topics) {
    var counts = { green: 0, amber: 0, red: 0, black: 0 };
    var best = null, worst = null;
    topics.forEach(function (t) {
      counts[t.band]++;
      if (t.value !== null) {
        if (!best || t.value > best.value) best = t;
        if (!worst || t.value < worst.value) worst = t;
      }
    });
    return { counts: counts, best: best, worst: worst, total: topics.length };
  }

  function overallAverage(topics) {
    var vals = topics.filter(function (t) { return t.value !== null; }).map(function (t) { return t.value; });
    if (!vals.length) return null;
    return vals.reduce(function (a, b) { return a + b; }, 0) / vals.length;
  }

  function predictedGrade(overall) {
    var bounds = (window.GRADE_BOUNDARIES || []).slice().sort(function (a, b) { return b.minPct - a.minPct; });
    if (overall === null || !bounds.length) return null;
    for (var i = 0; i < bounds.length; i++) {
      if (overall >= bounds[i].minPct) return bounds[i].grade;
    }
    return bounds[bounds.length - 1].grade;
  }

  function classTopicAverages(subskillCols, students) {
    return subskillCols.map(function (sc) {
      var vals = [];
      students.forEach(function (s) {
        var t = s.topics.filter(function (x) { return x.code === sc.code; })[0];
        if (t && t.value !== null) vals.push(t.value);
      });
      var avg = vals.length ? vals.reduce(function (a, b) { return a + b; }, 0) / vals.length : null;
      return { code: sc.code, desc: sc.desc, value: avg, band: band(avg === null ? "" : avg), n: vals.length };
    });
  }

  // top N topics for a given band, sorted so the most useful ones surface first:
  // green/amber highest-scoring first, red lowest-scoring (most urgent) first,
  // black (never seen) in spec order.
  function topBoxes(topics, bandKey) {
    var items = topics.filter(function (t) { return t.band === bandKey; });
    if (bandKey === "red") items.sort(function (a, b) { return a.value - b.value; });
    else if (bandKey === "black") { /* keep natural order */ }
    else items.sort(function (a, b) { return b.value - a.value; });
    return { shown: items.slice(0, TOP_N), more: Math.max(0, items.length - TOP_N), total: items.length };
  }

  // ---------- donut drawing (canvas) ----------

  function drawDonut(canvas, counts, total) {
    var ctx = canvas.getContext("2d");
    var W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    var cx = W / 2, cy = H / 2, rOuter = Math.min(W, H) / 2 - 3, rInner = rOuter * 0.56;
    var order = ["green", "amber", "red", "black"];
    if (!total) {
      ctx.beginPath(); ctx.arc(cx, cy, rOuter, 0, Math.PI * 2);
      ctx.fillStyle = "#E4E9EF"; ctx.fill();
    } else {
      var start = -Math.PI / 2;
      order.forEach(function (key) {
        var val = counts[key];
        if (!val) return;
        var angle = (val / total) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, rOuter, start, start + angle);
        ctx.closePath();
        ctx.fillStyle = RAG[key];
        ctx.fill();
        start += angle;
      });
    }
    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath(); ctx.arc(cx, cy, rInner, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#12233A";
    ctx.font = "700 20px Inter, sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    var seenPct = total ? Math.round(((total - counts.black) / total) * 100) : 0;
    ctx.fillText(seenPct + "%", cx, cy - 7);
    ctx.font = "600 10px 'Space Mono', monospace";
    ctx.fillStyle = "#63748A";
    ctx.fillText("SEEN", cx, cy + 14);
  }

  // ---------- DOM rendering ----------

  function legendHTML(counts, total) {
    var order = ["green", "amber", "red", "black"];
    return '<div class="rag-legend">' + order.map(function (k) {
      var n = counts[k];
      var p = total ? Math.round((n / total) * 100) : 0;
      return '<span class="rag-chip"><i style="background:' + RAG[k] + '"></i>' + RAG_LABEL[k] + " " + n + " (" + p + "%)</span>";
    }).join("") + "</div>";
  }

  function boxPanelHTML(label, bandKey, topics) {
    var r = topBoxes(topics, bandKey);
    return (
      '<div class="box-panel box-panel-' + bandKey + '">' +
        '<h4>' + label + " <span>" + r.total + "</span></h4>" +
        '<div class="chip-grid">' +
          (r.shown.length ? r.shown.map(function (t) {
            return '<div class="topic-chip"><span class="chip-code">' + t.code + '</span><span class="chip-desc">' + (t.desc || "") + '</span>' +
              (t.value !== null ? '<span class="chip-pct">' + pct(t.value) + '</span>' : "") + '</div>';
          }).join("") : '<p class="chip-empty">None yet</p>') +
        "</div>" +
        (r.more ? '<p class="chip-more">+' + r.more + " more not shown</p>" : "") +
      "</div>"
    );
  }

  function gradeExplainer() {
    return ("Estimated by comparing the average score across every topic assessed so far to AQA's most recently " +
            "published grade boundaries for this qualification (1350A, June 2023 series: A 82%, B 72%, C 63%, D 53%, " +
            "E 44% of 120 total marks). Boundaries move slightly every year, so treat this as an indicative estimate, not an official prediction.");
  }

  function renderStudentCard(student, index) {
    var s = summariseTopics(student.topics);
    var overall = overallAverage(student.topics);
    var grade = predictedGrade(overall);
    var el = document.createElement("div");
    el.className = "report-card";
    el.innerHTML =
      '<div class="report-card-main">' +
        "<h3>" + (student.name || "(unnamed)") + "</h3>" +
        '<div class="chip-grid-wrap">' +
          boxPanelHTML("Mastered", "green", student.topics) +
          boxPanelHTML("Partial understanding", "amber", student.topics) +
          boxPanelHTML("Needs work", "red", student.topics) +
          boxPanelHTML("Not yet seen", "black", student.topics) +
        "</div>" +
      "</div>" +
      '<div class="report-card-side">' +
        '<canvas class="donut" width="170" height="170" data-role="donut" data-idx="' + index + '"></canvas>' +
        legendHTML(s.counts, s.total) +
        '<div class="details-panel">' +
          (student.form ? "<div><strong>Form</strong> " + student.form + "</div>" : "") +
          (student.dob ? "<div><strong>Date of birth</strong> " + student.dob + "</div>" : "") +
        "</div>" +
        '<div class="grade-badge-wrap">' +
          '<div class="grade-badge">' + (grade || "—") + "</div>" +
          '<div class="grade-label">Predicted grade' + (overall !== null ? " (avg " + pct(overall) + ")" : "") + "</div>" +
          '<p class="grade-explain">' + gradeExplainer() + "</p>" +
        "</div>" +
        '<div class="best-worst-callout">' +
          (s.best ? '<div class="bw-row bw-best"><strong>Strongest</strong>' + s.best.code + " " + (s.best.desc || "") + " — " + pct(s.best.value) + "</div>" : "") +
          (s.worst ? '<div class="bw-row bw-worst"><strong>Weakest</strong>' + s.worst.code + " " + (s.worst.desc || "") + " — " + pct(s.worst.value) + "</div>" : "") +
        "</div>" +
      "</div>";
    return el;
  }

  function renderClassSummary(subskillCols, students) {
    var averages = classTopicAverages(subskillCols, students);
    var s = summariseTopics(averages);
    var grades = { A: 0, B: 0, C: 0, D: 0, E: 0, U: 0, "—": 0 };
    students.forEach(function (st) {
      var g = predictedGrade(overallAverage(st.topics)) || "—";
      grades[g] = (grades[g] || 0) + 1;
    });

    var wrap = document.createElement("div");
    wrap.className = "report-card";
    wrap.innerHTML =
      '<div class="report-card-main">' +
        '<div class="chip-grid-wrap">' +
          boxPanelHTML("Class has mastered", "green", averages) +
          boxPanelHTML("Class — partial understanding", "amber", averages) +
          boxPanelHTML("Class needs work", "red", averages) +
          boxPanelHTML("Not yet seen by the class", "black", averages) +
        "</div>" +
      "</div>" +
      '<div class="report-card-side">' +
        '<canvas class="donut" width="170" height="170" data-role="class-donut"></canvas>' +
        legendHTML(s.counts, s.total) +
        '<div class="details-panel"><div><strong>' + students.length + "</strong> student" + (students.length === 1 ? "" : "s") + " in this upload</div></div>" +
        '<div class="grade-badge-wrap">' +
          '<div class="grade-label">Predicted grade spread</div>' +
          '<div class="grade-dist">' + ["A", "B", "C", "D", "E", "U", "—"].map(function (g) {
            return grades[g] ? '<span class="grade-pill">' + g + ": " + grades[g] + "</span>" : "";
          }).join("") + "</div>" +
          '<p class="grade-explain">' + gradeExplainer() + "</p>" +
        "</div>" +
      "</div>";
    return { el: wrap, counts: s.counts, total: s.total, averages: averages };
  }

  // ---------- PDF generation (A4 landscape, one full page per student) ----------

  function buildPDF(students, classDonutDataUrl, studentDonutDataUrls, classInfo) {
    var jsPDFCtor = window.jspdf.jsPDF;
    var doc = new jsPDFCtor({ unit: "pt", format: "a4", orientation: "landscape" });
    var pageW = doc.internal.pageSize.getWidth();
    var pageH = doc.internal.pageSize.getHeight();
    var margin = 36;
    var sideW = 220;
    var mainX = margin, mainW = pageW - margin * 2 - sideW - 24;
    var sideX = pageW - margin - sideW;

    function hexToRgb(hex) {
      var m = hex.replace("#", "");
      return [parseInt(m.substr(0, 2), 16), parseInt(m.substr(2, 2), 16), parseInt(m.substr(4, 2), 16)];
    }
    function footer() {
      doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(150, 158, 170);
      doc.text("Core Maths Compendium — Course Tracker report · generated locally in your browser", margin, pageH - 16);
    }
    // small brand tag, top-right of every page: a green mark + "Mr Pohl's Core Maths Compendium"
    function pageHeader() {
      doc.setFont("helvetica", "bold"); doc.setFontSize(9);
      var label = "MR POHL'S CORE MATHS COMPENDIUM";
      var textW = doc.getStringUnitWidth(label) * 9 / doc.internal.scaleFactor;
      var markSize = 16, gap = 8;
      var totalW = markSize + gap + textW;
      var startX = pageW - margin - totalW;
      var markRgb = hexToRgb(RAG.green);
      doc.setFillColor(markRgb[0], markRgb[1], markRgb[2]);
      doc.roundedRect(startX, margin - 14, markSize, markSize, 4, 4, "F");
      doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(255, 255, 255);
      doc.text("σ", startX + markSize / 2, margin - 14 + markSize / 2 + 3.2, { align: "center" });
      doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(18, 35, 58);
      doc.text(label, startX + markSize + gap, margin - 14 + markSize / 2 + 3);
    }
    function roundRect(x, y, w, h, r, rgb) {
      doc.setFillColor(rgb[0], rgb[1], rgb[2]);
      doc.roundedRect(x, y, w, h, r, r, "F");
    }
    function legendBlock(x, y, counts, total) {
      var order = [["green", "Mastered"], ["amber", "Partial"], ["red", "Needs work"], ["black", "Not seen"]];
      order.forEach(function (pair) {
        var key = pair[0], label = pair[1];
        var n = counts[key], p = total ? Math.round((n / total) * 100) : 0;
        var rgb = hexToRgb(RAG[key]);
        doc.setFillColor(rgb[0], rgb[1], rgb[2]);
        doc.rect(x, y - 8, 9, 9, "F");
        doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(31, 42, 55);
        doc.text(label + " " + n + " (" + p + "%)", x + 13, y);
        y += 14;
      });
      return y;
    }

    // one panel of up to 10 chip boxes for a RAG band, returns bottom y used
    function chipPanel(x, y, w, label, bandKey, topics) {
      var r = topBoxes(topics, bandKey);
      var rgb = hexToRgb(RAG[bandKey]);
      doc.setFont("helvetica", "bold"); doc.setFontSize(10.5);
      doc.setTextColor(rgb[0], rgb[1], rgb[2]);
      doc.text(label + " (" + r.total + ")", x, y);
      y += 12;
      doc.setDrawColor(228, 233, 239);
      doc.setLineWidth(0.6);
      doc.line(x, y - 4, x + w, y - 4);
      y += 6;
      if (!r.shown.length) {
        doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(150, 158, 170);
        doc.text("None yet", x, y); return y + 14;
      }
      var boxH = 30, gap = 6, perRow = 2, boxW = (w - gap) / perRow;
      r.shown.forEach(function (t, i) {
        var col = i % perRow, row = Math.floor(i / perRow);
        var bx = x + col * (boxW + gap), by = y + row * (boxH + gap);
        doc.setFillColor(250, 250, 248);
        doc.setDrawColor(228, 233, 239);
        doc.roundedRect(bx, by, boxW, boxH, 4, 4, "FD");
        doc.setDrawColor.apply(doc, [rgb[0], rgb[1], rgb[2]]);
        doc.setFillColor(rgb[0], rgb[1], rgb[2]);
        doc.rect(bx, by, 3, boxH, "F");
        doc.setFont("helvetica", "bold"); doc.setFontSize(8.5); doc.setTextColor(18, 35, 58);
        doc.text(t.code + (t.value !== null ? "  " + pct(t.value) : ""), bx + 8, by + 12);
        doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(99, 116, 138);
        var desc = doc.splitTextToSize(t.desc || "", boxW - 12)[0] || "";
        doc.text(desc, bx + 8, by + 23);
      });
      var rows = Math.ceil(r.shown.length / perRow);
      y += rows * (boxH + gap);
      if (r.more) {
        doc.setFont("helvetica", "italic"); doc.setFontSize(8); doc.setTextColor(150, 158, 170);
        doc.text("+" + r.more + " more not shown", x, y + 4);
        y += 14;
      }
      return y + 10;
    }

    function drawSidePanel(x, y, w, donutUrl, counts, total, detailsLines, gradeInfo, bestWorst) {
      doc.addImage(donutUrl, "PNG", x + (w - 150) / 2, y, 150, 150);
      y += 168;
      y = legendBlock(x, y, counts, total) + 10;

      if (detailsLines.length) {
        doc.setDrawColor(228, 233, 239); doc.setLineWidth(0.6); doc.line(x, y, x + w, y); y += 16;
        detailsLines.forEach(function (line) {
          doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.setTextColor(31, 42, 55);
          doc.text(line, x, y); y += 15;
        });
        y += 4;
      }

      doc.setDrawColor(228, 233, 239); doc.setLineWidth(0.6); doc.line(x, y, x + w, y); y += 18;
      if (gradeInfo.badge) {
        doc.setFillColor(18, 35, 58);
        doc.circle(x + 20, y + 6, 18, "F");
        doc.setFont("helvetica", "bold"); doc.setFontSize(15); doc.setTextColor(255, 255, 255);
        doc.text(String(gradeInfo.badge), x + 20, y + 11, { align: "center" });
        doc.setFont("helvetica", "bold"); doc.setFontSize(9.5); doc.setTextColor(18, 35, 58);
        doc.text(gradeInfo.label, x + 46, y + 3);
        doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(99, 116, 138);
        var sub = doc.splitTextToSize(gradeInfo.sub || "", w - 46);
        doc.text(sub, x + 46, y + 14);
        y += 34;
      } else {
        doc.setFont("helvetica", "bold"); doc.setFontSize(9.5); doc.setTextColor(18, 35, 58);
        doc.text(gradeInfo.label, x, y); y += 14;
        (gradeInfo.pills || []).forEach(function (line) {
          doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(31, 42, 55);
          doc.text(line, x, y); y += 13;
        });
        y += 4;
      }
      doc.setFont("helvetica", "italic"); doc.setFontSize(7);
      doc.setTextColor(150, 158, 170);
      var explainLines = doc.splitTextToSize(gradeExplainer(), w);
      explainLines.forEach(function (l) { doc.text(l, x, y); y += 9; });
      y += 8;

      if (bestWorst) {
        doc.setDrawColor(228, 233, 239); doc.setLineWidth(0.6); doc.line(x, y, x + w, y); y += 16;
        if (bestWorst.best) {
          var g = hexToRgb(RAG.green);
          doc.setFillColor(g[0], g[1], g[2]); doc.rect(x, y - 9, 3, 24, "F");
          doc.setFont("helvetica", "bold"); doc.setFontSize(8.5); doc.setTextColor(g[0], g[1], g[2]);
          doc.text("STRONGEST", x + 8, y - 2);
          doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(31, 42, 55);
          doc.text(bestWorst.best.code + " " + (bestWorst.best.desc || "").slice(0, 40) + " — " + pct(bestWorst.best.value), x + 8, y + 10);
          y += 26;
        }
        if (bestWorst.worst) {
          var rd = hexToRgb(RAG.red);
          doc.setFillColor(rd[0], rd[1], rd[2]); doc.rect(x, y - 9, 3, 24, "F");
          doc.setFont("helvetica", "bold"); doc.setFontSize(8.5); doc.setTextColor(rd[0], rd[1], rd[2]);
          doc.text("WEAKEST", x + 8, y - 2);
          doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(31, 42, 55);
          doc.text(bestWorst.worst.code + " " + (bestWorst.worst.desc || "").slice(0, 40) + " — " + pct(bestWorst.worst.value), x + 8, y + 10);
          y += 26;
        }
      }
      return y;
    }

    // ---- class summary page ----
    pageHeader();
    var y = margin + 6;
    doc.setFont("helvetica", "bold"); doc.setFontSize(19); doc.setTextColor(18, 35, 58);
    doc.text("AQA Core Maths — Class Progress Report", mainX, y);
    doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(99, 116, 138);
    doc.text(new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }), mainX, y + 16);
    y += 40;

    var grades = { A: 0, B: 0, C: 0, D: 0, E: 0, U: 0, "—": 0 };
    students.forEach(function (st) {
      var g = predictedGrade(overallAverage(st.topics)) || "—";
      grades[g] = (grades[g] || 0) + 1;
    });
    var pills = ["A", "B", "C", "D", "E", "U", "—"].filter(function (g) { return grades[g]; })
      .map(function (g) { return g + ": " + grades[g]; });

    drawSidePanel(sideX, y, sideW, classDonutDataUrl, classInfo.counts, classInfo.total,
      [students.length + " student" + (students.length === 1 ? "" : "s") + " in this report"],
      { label: "Predicted grade spread", pills: pills },
      { best: classInfo.best, worst: classInfo.worst });

    var colW = (mainW - 20) / 2;
    var y1 = chipPanel(mainX, y, colW, "Class has mastered", "green", classInfo.averages);
    var y2 = chipPanel(mainX + colW + 20, y, colW, "Partial understanding", "amber", classInfo.averages);
    var yy = Math.max(y1, y2);
    var y3 = chipPanel(mainX, yy, colW, "Needs work", "red", classInfo.averages);
    var y4 = chipPanel(mainX + colW + 20, yy, colW, "Not yet seen", "black", classInfo.averages);
    footer();

    // ---- one landscape page per student ----
    students.forEach(function (student, idx) {
      doc.addPage("a4", "landscape");
      pageHeader();
      var s = summariseTopics(student.topics);
      var overall = overallAverage(student.topics);
      var grade = predictedGrade(overall);

      var yy2 = margin + 6;
      doc.setFont("helvetica", "bold"); doc.setFontSize(20); doc.setTextColor(18, 35, 58);
      doc.text(student.name || "(unnamed student)", mainX, yy2);
      yy2 += 30;

      var detailLines = [];
      if (student.form) detailLines.push("Form: " + student.form);
      if (student.dob) detailLines.push("Date of birth: " + student.dob);

      drawSidePanel(sideX, yy2, sideW, studentDonutDataUrls[idx], s.counts, s.total, detailLines,
        { badge: grade || "—", label: "Predicted grade" + (overall !== null ? " (avg " + pct(overall) + ")" : "") },
        { best: s.best, worst: s.worst });

      var cw = (mainW - 20) / 2;
      var l1 = chipPanel(mainX, yy2, cw, "Mastered", "green", student.topics);
      var l2 = chipPanel(mainX + cw + 20, yy2, cw, "Partial understanding", "amber", student.topics);
      var lm = Math.max(l1, l2);
      var l3 = chipPanel(mainX, lm, cw, "Needs work", "red", student.topics);
      var l4 = chipPanel(mainX + cw + 20, lm, cw, "Not yet seen", "black", student.topics);
      footer();
    });

    doc.save("Core Maths Class Progress Report.pdf");
  }

  // ---------- wiring ----------

  document.addEventListener("DOMContentLoaded", function () {
    var dropzone = document.getElementById("dropzone");
    var fileInput = document.getElementById("file-input");
    var status = document.getElementById("tool-status");
    var preview = document.getElementById("report-preview");
    var classCard = document.getElementById("class-summary-card");
    var studentCards = document.getElementById("student-cards");
    var downloadBtn = document.getElementById("download-pdf");
    if (!dropzone) return;

    dropzone.addEventListener("click", function () { fileInput.click(); });
    dropzone.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") fileInput.click(); });
    ["dragover", "dragenter"].forEach(function (evt) {
      dropzone.addEventListener(evt, function (e) { e.preventDefault(); dropzone.classList.add("dragover"); });
    });
    ["dragleave", "drop"].forEach(function (evt) {
      dropzone.addEventListener(evt, function (e) { e.preventDefault(); dropzone.classList.remove("dragover"); });
    });
    dropzone.addEventListener("drop", function (e) {
      if (e.dataTransfer.files && e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
    });
    fileInput.addEventListener("change", function (e) {
      if (e.target.files && e.target.files.length) handleFile(e.target.files[0]);
    });

    function setStatus(msg, cls) {
      status.textContent = msg || "";
      status.className = "form-status" + (cls ? " " + cls : "");
    }

    function handleFile(file) {
      setStatus("Reading " + file.name + "…");
      preview.hidden = true;
      var reader = new FileReader();
      reader.onload = function (e) {
        try {
          var wb = XLSX.read(new Uint8Array(e.target.result), { type: "array", cellFormula: false, cellDates: true });
          var parsedData = parseWorkbook(wb);
          renderPreview(parsedData);
          setStatus("Loaded " + parsedData.students.length + " student(s). Report ready below.", "ok");
        } catch (err) {
          setStatus(err.message || "Couldn't read that file.", "err");
        }
      };
      reader.onerror = function () { setStatus("Couldn't read that file — please try again.", "err"); };
      reader.readAsArrayBuffer(file);
    }

    function renderPreview(data) {
      classCard.innerHTML = "";
      studentCards.innerHTML = "";
      var classResult = renderClassSummary(data.subskillCols, data.students);
      classCard.appendChild(classResult.el);

      data.students.forEach(function (student, idx) {
        studentCards.appendChild(renderStudentCard(student, idx));
      });
      preview.hidden = false;

      var classDonut = classCard.querySelector('[data-role="class-donut"]');
      drawDonut(classDonut, classResult.counts, classResult.total);
      var donutEls = studentCards.querySelectorAll('[data-role="donut"]');
      data.students.forEach(function (student, idx) {
        var s = summariseTopics(student.topics);
        drawDonut(donutEls[idx], s.counts, s.total);
      });

      downloadBtn.onclick = function () {
        setStatus("Building PDF…");
        setTimeout(function () {
          try {
            var classDonutUrl = classDonut.toDataURL("image/png");
            var studentUrls = [];
            donutEls.forEach(function (c) { studentUrls.push(c.toDataURL("image/png")); });
            buildPDF(data.students, classDonutUrl, studentUrls, classResult);
            setStatus("PDF downloaded.", "ok");
          } catch (err) {
            setStatus("Couldn't build the PDF: " + err.message, "err");
          }
        }, 30);
      };
    }
  });
})();
