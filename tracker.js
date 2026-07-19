/* tracker.js — Core Maths Compendium course tracker tool.
   Everything runs client-side: the uploaded workbook is parsed with SheetJS in the
   browser and the PDF report is built with jsPDF. No file is ever sent anywhere.
   The workbook itself carries no logic at all — it's a plain fill-in-the-blanks
   grid. All the scoring, banding and topic mapping is defined in tracker-data.js
   and applied here, at upload time. */

(function () {
  "use strict";

  var RAG = { green: "#1B998B", amber: "#F4A93F", red: "#c0392b", black: "#12233A" };
  var RAG_LABEL = { green: "Mastered", amber: "Partial", red: "Needs work", black: "Not seen" };

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

  // ---------- workbook parsing ----------
  // Reads raw marks straight off each plain test sheet (no formulas or lookups
  // involved) and works out every student's per-topic average itself, using the
  // question -> subskill map in tracker-data.js.

  function parseWorkbook(wb) {
    var spec = window.TRACKER_SPEC || [];
    var subskillList = window.SUBSKILLS || [];
    var specByName = {};
    spec.forEach(function (s) { specByName[s.sheet] = s; });

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
      return { name: s.name, group: "", id: "", topics: topics };
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
    ctx.font = "700 15px Inter, sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    var seenPct = total ? Math.round(((total - counts.black) / total) * 100) : 0;
    ctx.fillText(seenPct + "%", cx, cy - 6);
    ctx.font = "600 9px 'Space Mono', monospace";
    ctx.fillStyle = "#63748A";
    ctx.fillText("SEEN", cx, cy + 11);
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

  function topicListHTML(label, band, topics) {
    var list = topics.filter(function (t) { return t.band === band; });
    if (!list.length) return "";
    return '<div class="topic-list"><h4 style="color:' + RAG[band] + '">' + label + " (" + list.length + ")</h4><ul>" +
      list.map(function (t) { return "<li><strong>" + t.code + "</strong> " + (t.desc || "") + (t.value !== null ? " — " + pct(t.value) : "") + "</li>"; }).join("") +
      "</ul></div>";
  }

  function renderStudentCard(student, index) {
    var s = summariseTopics(student.topics);
    var el = document.createElement("div");
    el.className = "student-card";
    el.innerHTML =
      '<div class="student-card-head">' +
        "<h3>" + (student.name || "(unnamed)") + "</h3>" +
      "</div>" +
      '<div class="student-card-body">' +
        '<canvas class="donut" width="150" height="150" data-role="donut" data-idx="' + index + '"></canvas>' +
        "<div>" + legendHTML(s.counts, s.total) +
          '<p class="best-worst">' +
            (s.best ? "<strong>Strongest:</strong> " + s.best.code + " " + (s.best.desc || "") + " (" + pct(s.best.value) + ")<br/>" : "") +
            (s.worst ? "<strong>Weakest:</strong> " + s.worst.code + " " + (s.worst.desc || "") + " (" + pct(s.worst.value) + ")" : "") +
          "</p>" +
        "</div>" +
      "</div>" +
      topicListHTML("Green — mastered", "green", student.topics) +
      topicListHTML("Amber — partial understanding", "amber", student.topics) +
      topicListHTML("Red — needs work", "red", student.topics);
    return el;
  }

  function renderClassSummary(subskillCols, students) {
    var averages = classTopicAverages(subskillCols, students);
    var s = summariseTopics(averages);
    var attempted = averages.filter(function (a) { return a.value !== null; });
    var best = attempted.length ? attempted.reduce(function (a, b) { return b.value > a.value ? b : a; }) : null;
    var worst = attempted.length ? attempted.reduce(function (a, b) { return b.value < a.value ? b : a; }) : null;

    var wrap = document.createElement("div");
    wrap.innerHTML =
      '<div class="student-card-body">' +
        '<canvas class="donut" width="170" height="170" data-role="class-donut"></canvas>' +
        "<div>" + legendHTML(s.counts, s.total) +
          '<p class="best-worst">' +
            "<strong>" + students.length + "</strong> student" + (students.length === 1 ? "" : "s") + " in this upload.<br/>" +
            (best ? "<strong>Strongest topic class-wide:</strong> " + best.code + " " + (best.desc || "") + " (" + pct(best.value) + " average)<br/>" : "") +
            (worst ? "<strong>Weakest topic class-wide:</strong> " + worst.code + " " + (worst.desc || "") + " (" + pct(worst.value) + " average)" : "") +
          "</p>" +
        "</div>" +
      "</div>" +
      topicListHTML("Green — class has mastered", "green", averages) +
      topicListHTML("Amber — class has partial understanding", "amber", averages) +
      topicListHTML("Red — class needs work", "red", averages) +
      topicListHTML("Not yet seen by the class", "black", averages);
    return { el: wrap, counts: s.counts, total: s.total, averages: averages, best: best, worst: worst };
  }

  // ---------- PDF generation ----------

  function buildPDF(subskillCols, students, classDonutDataUrl, studentDonutDataUrls, classInfo) {
    var jsPDFCtor = window.jspdf.jsPDF;
    var doc = new jsPDFCtor({ unit: "pt", format: "a4" });
    var pageW = doc.internal.pageSize.getWidth();
    var pageH = doc.internal.pageSize.getHeight();
    var margin = 42;

    function heading(text, y) {
      doc.setFont("helvetica", "bold"); doc.setFontSize(18); doc.setTextColor(18, 35, 58);
      doc.text(text, margin, y);
      return y + 22;
    }
    function sub(text, y, size, color) {
      doc.setFont("helvetica", "normal"); doc.setFontSize(size || 10.5);
      doc.setTextColor.apply(doc, color || [99, 116, 138]);
      doc.text(text, margin, y);
      return y;
    }
    function footer() {
      doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(150, 158, 170);
      doc.text("Core Maths Compendium — Course Tracker report · generated locally in your browser", margin, pageH - 20);
    }
    function legendBlock(x, y, counts, total) {
      var order = [["green", "Mastered"], ["amber", "Partial"], ["red", "Needs work"], ["black", "Not seen"]];
      order.forEach(function (pair) {
        var key = pair[0], label = pair[1];
        var n = counts[key], p = total ? Math.round((n / total) * 100) : 0;
        var rgb = hexToRgb(RAG[key]);
        doc.setFillColor(rgb[0], rgb[1], rgb[2]);
        doc.rect(x, y - 8, 10, 10, "F");
        doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.setTextColor(31, 42, 55);
        doc.text(label + " " + n + " (" + p + "%)", x + 15, y);
        y += 16;
      });
      return y;
    }
    function topicLines(x, y, maxW, label, band, topics, color) {
      var list = topics.filter(function (t) { return t.band === band; });
      if (!list.length) return y;
      var rgb = hexToRgb(color);
      doc.setFont("helvetica", "bold"); doc.setFontSize(10.5); doc.setTextColor(rgb[0], rgb[1], rgb[2]);
      doc.text(label + " (" + list.length + ")", x, y);
      y += 13;
      doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(31, 42, 55);
      list.forEach(function (t) {
        var line = t.code + "  " + (t.desc || "") + (t.value !== null ? "  (" + pct(t.value) + ")" : "");
        var wrapped = doc.splitTextToSize(line, maxW);
        wrapped.forEach(function (wl) {
          if (y > pageH - 60) { footer(); doc.addPage(); y = margin; }
          doc.text(wl, x, y); y += 12;
        });
      });
      return y + 8;
    }

    // ---- Cover / class summary page ----
    var y = margin + 10;
    y = heading("AQA Core Maths — Class Progress Report", y);
    y = sub(new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }), y + 14);
    y += 26;
    doc.addImage(classDonutDataUrl, "PNG", margin, y, 150, 150);
    var legY = legendBlock(margin + 175, y + 34, classInfo.counts, classInfo.total);
    doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(31, 42, 55);
    var infoX = margin + 175, infoY = legY + 10;
    doc.text(students.length + " student" + (students.length === 1 ? "" : "s") + " in this report", infoX, infoY); infoY += 16;
    if (classInfo.best) { doc.text("Strongest topic: " + classInfo.best.code + " (" + pct(classInfo.best.value) + " avg)", infoX, infoY); infoY += 14; }
    if (classInfo.worst) { doc.text("Weakest topic: " + classInfo.worst.code + " (" + pct(classInfo.worst.value) + " avg)", infoX, infoY); infoY += 14; }
    y += 175;

    var colW = (pageW - margin * 2 - 24) / 2;
    var yLeft = topicLines(margin, y, colW, "Green — class has mastered", "green", classInfo.averages, RAG.green);
    var yRight = topicLines(margin + colW + 24, y, colW, "Amber — partial understanding", "amber", classInfo.averages, RAG.amber);
    y = Math.max(yLeft, yRight);
    yLeft = topicLines(margin, y, colW, "Red — needs work", "red", classInfo.averages, RAG.red);
    yRight = topicLines(margin + colW + 24, y, colW, "Not yet seen", "black", classInfo.averages, RAG.black);
    footer();

    // ---- one page per student ----
    students.forEach(function (student, idx) {
      doc.addPage();
      var s = summariseTopics(student.topics);
      var yy = margin + 10;
      yy = heading(student.name || "(unnamed student)", yy);
      yy += 20;
      doc.addImage(studentDonutDataUrls[idx], "PNG", margin, yy, 140, 140);
      var ly = legendBlock(margin + 165, yy + 26, s.counts, s.total);
      doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(31, 42, 55);
      var ix = margin + 165, iy = ly + 10;
      if (s.best) { doc.text("Strongest: " + s.best.code + " " + doc.splitTextToSize(s.best.desc || "", 220)[0] + " (" + pct(s.best.value) + ")", ix, iy); iy += 14; }
      if (s.worst) { doc.text("Weakest: " + s.worst.code + " " + doc.splitTextToSize(s.worst.desc || "", 220)[0] + " (" + pct(s.worst.value) + ")", ix, iy); iy += 14; }
      yy += 160;
      var cw = (pageW - margin * 2 - 24) / 2;
      var l1 = topicLines(margin, yy, cw, "Green — mastered", "green", student.topics, RAG.green);
      var l2 = topicLines(margin + cw + 24, yy, cw, "Amber — partial", "amber", student.topics, RAG.amber);
      yy = Math.max(l1, l2);
      topicLines(margin, yy, cw, "Red — needs work", "red", student.topics, RAG.red);
      footer();
    });

    doc.save("Core Maths Class Progress Report.pdf");
  }

  function hexToRgb(hex) {
    var m = hex.replace("#", "");
    return [parseInt(m.substr(0, 2), 16), parseInt(m.substr(2, 2), 16), parseInt(m.substr(4, 2), 16)];
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

    var parsedData = null;

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
          var wb = XLSX.read(new Uint8Array(e.target.result), { type: "array", cellFormula: false });
          parsedData = parseWorkbook(wb);
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
            buildPDF(data.subskillCols, data.students, classDonutUrl, studentUrls, classResult);
            setStatus("PDF downloaded.", "ok");
          } catch (err) {
            setStatus("Couldn't build the PDF: " + err.message, "err");
          }
        }, 30);
      };
    }
  });
})();
