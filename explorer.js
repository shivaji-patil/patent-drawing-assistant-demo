/* Answer explorer: every saved answer of the development question set, shown as the assistant returned it.
   Data: data/demo.json, written by scripts/build_site.py from data/answers/qa_dev/. No server, no model calls. */
(function () {
  "use strict";
  var root = document.getElementById("explorer");
  if (!root) return;
  var SYSTEMS = [["ocr_lookup", "ocr_lookup", "no LLM"], ["text_only", "text_only", "LLM, text"], ["full", "full", "LLM, text + drawings"]];
  var state = { patent: null, question: null, system: "full" };
  var data = null;

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (key) {
      if (key === "text") node.textContent = attrs[key];
      else if (key === "html") node.innerHTML = attrs[key];
      else node.setAttribute(key, attrs[key]);
    });
    (children || []).forEach(function (child) { if (child) node.appendChild(child); });
    return node;
  }

  /* The passage with the quote marked. The quote check ignores spacing and case, so the search does too. */
  function highlighted(passage, quote) {
    var span = el("span", { class: "passage" });
    var chars = quote.replace(/\s+/g, "").split("").map(function (ch) {
      return ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    });
    var match = chars.length ? new RegExp(chars.join("\\s*"), "i").exec(passage) : null;
    if (!match) { span.textContent = passage; return span; }
    span.appendChild(document.createTextNode(passage.slice(0, match.index)));
    span.appendChild(el("mark", { class: "quote", text: match[0] }));
    span.appendChild(document.createTextNode(passage.slice(match.index + match[0].length)));
    return span;
  }

  function sheetFigure(patent, page, cites) {
    var sheet = patent.sheets[page];
    var ns = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 " + sheet.width + " " + sheet.height);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "Drawing sheet " + page + " with " + cites.length + " cited label" + (cites.length === 1 ? "" : "s") + " boxed");
    var image = document.createElementNS(ns, "image");
    image.setAttribute("href", sheet.image);
    image.setAttribute("width", sheet.width);
    image.setAttribute("height", sheet.height);
    svg.appendChild(image);
    cites.forEach(function (cite) {
      var halfW = 30 + 14 * cite.part_number.length, halfH = 40;
      var rect = document.createElementNS(ns, "rect");
      rect.setAttribute("x", cite.x - halfW); rect.setAttribute("y", cite.y - halfH);
      rect.setAttribute("width", 2 * halfW); rect.setAttribute("height", 2 * halfH);
      rect.setAttribute("class", "box");
      svg.appendChild(rect);
      var label = document.createElementNS(ns, "text");
      label.setAttribute("x", cite.x - halfW); label.setAttribute("y", Math.max(56, cite.y - halfH - 16));
      label.setAttribute("class", "boxlabel");
      label.textContent = cite.label_id;
      svg.appendChild(label);
    });
    var figures = sheet.figures.length ? "FIG. " + sheet.figures.join(", ") : "figure label not read";
    return el("figure", { class: "sheet" }, [el("div", { class: "sheetframe" }, [svg]),
      el("figcaption", { text: "Sheet " + page + " (" + figures + "): " + cites.map(function (c) { return c.label_id; }).join(", ") })]);
  }

  function verdict(question, answer) {
    var bits = [];
    if (!question.on_drawings) {
      var invented = answer.parts.some(function (p) { return p.number === question.part_number; }) ||
        answer.drawing_citations.some(function (c) { return c.part_number === question.part_number; });
      bits.push(invented ? ["bad", "Treated a number the patent does not use as a part"] : ["good", "Named no part and cited no region for this unused number"]);
      return bits;
    }
    bits.push(answer.name_correct ? ["good", "Name matches the gold"] : ["bad", "Name does not match the gold (" + question.gold_names.join(" / ") + ")"]);
    var gold = 0, found = 0, perSheet = {};
    Object.keys(question.gold_sheets).forEach(function (s) { gold += question.gold_sheets[s]; });
    answer.drawing_citations.forEach(function (c) {
      if (c.part_number === question.part_number) perSheet[c.sheet_page] = (perSheet[c.sheet_page] || 0) + 1;
    });
    Object.keys(perSheet).forEach(function (s) { found += Math.min(perSheet[s], question.gold_sheets[s] || 0); });
    bits.push([found === gold ? "good" : (found ? "mid" : "bad"), found + " of " + gold + " places on the drawings found"]);
    return bits;
  }

  function render() {
    var patent = data.patents[state.patent];
    var question = patent.questions[state.question];
    var answer = question.answers[state.system];
    var out = root.querySelector(".ex-out");
    out.textContent = "";
    out.appendChild(el("div", { class: "qa" }, [el("p", { class: "q", text: question.question }), el("p", { class: "a", text: answer.answer })]));
    out.appendChild(el("p", { class: "ex-verdict" }, verdict(question, answer).map(function (bit) {
      return el("span", { class: "tag " + bit[0], text: bit[1] });
    }).concat([el("span", { class: "tag", text: answer.seconds < 0.01 ? "under 0.01 s" : answer.seconds.toFixed(1) + " s" }),
      el("span", { class: "tag", text: answer.cost ? "$" + answer.cost.toFixed(2) + " list price" : "no model call" })])));

    out.appendChild(el("h3", { text: "Text citations (" + answer.text_citations.length + ")" }));
    if (!answer.text_citations.length) out.appendChild(el("p", { class: "small", text: "None." }));
    out.appendChild(el("ul", { class: "cites" }, answer.text_citations.map(function (cite) {
      return el("li", {}, [el("span", { class: "id", text: "[" + cite.passage_id + "]" }),
        el("span", { class: "ok", text: "✓ quote found in passage" }), highlighted(cite.passage, cite.quote)]);
    })));

    var regions = answer.drawing_citations;
    out.appendChild(el("h3", { text: "Drawing citations (" + regions.length + ")" }));
    if (!regions.length) {
      out.appendChild(el("p", { class: "small", text: state.system === "text_only" ? "This system is given no drawings, so it cannot cite any." : "None." }));
    }
    var pages = [];
    regions.forEach(function (c) { if (pages.indexOf(c.sheet_page) < 0) pages.push(c.sheet_page); });
    pages.sort(function (a, b) { return a - b; });
    out.appendChild(el("div", { class: "ex-sheets" }, pages.map(function (page) {
      return sheetFigure(patent, page, regions.filter(function (c) { return c.sheet_page === page; }));
    })));

    if (answer.rejected.length) {
      out.appendChild(el("h3", { text: "Rejected by the checks (" + answer.rejected.length + ")" }));
      out.appendChild(el("ul", { class: "cites" }, answer.rejected.map(function (cite) {
        return el("li", { class: "rej" }, [el("span", { class: "id", text: "[" + (cite.passage_id || cite.label_id) + "]" }),
          document.createTextNode(cite.reason + (cite.quote ? ": “" + cite.quote + "”" : ""))]);
      })));
    }
  }

  function fillQuestions() {
    var select = root.querySelector("#ex-question");
    select.textContent = "";
    data.patents[state.patent].questions.forEach(function (question, i) {
      select.appendChild(el("option", { value: i, text: "Part " + question.part_number + (question.on_drawings ? "" : " (a number the patent does not use)") }));
    });
    state.question = Math.min(3, select.options.length - 1);
    select.value = state.question;
  }

  function build() {
    var patentSelect = el("select", { id: "ex-patent" }, Object.keys(data.patents).map(function (number) {
      var p = data.patents[number];
      return el("option", { value: number, text: "US " + p.pretty + " · " + p.subject });
    }));
    var questionSelect = el("select", { id: "ex-question" });
    var systems = el("div", { class: "ex-systems", role: "group", "aria-label": "Answer system" }, SYSTEMS.map(function (s) {
      return el("button", { type: "button", "data-system": s[0], "aria-pressed": s[0] === state.system ? "true" : "false",
        html: s[1] + ' <span class="n">' + s[2] + "</span>" });
    }));
    root.textContent = "";
    root.appendChild(el("div", { class: "ex-controls" }, [
      el("label", { for: "ex-patent", text: "Patent" }), patentSelect,
      el("label", { for: "ex-question", text: "Question" }), questionSelect, systems]));
    root.appendChild(el("div", { class: "ex-out", "aria-live": "polite" }));
    state.patent = data.start_patent;
    patentSelect.value = state.patent;
    fillQuestions();
    patentSelect.addEventListener("change", function () { state.patent = patentSelect.value; fillQuestions(); render(); });
    questionSelect.addEventListener("change", function () { state.question = +questionSelect.value; render(); });
    systems.addEventListener("click", function (event) {
      var button = event.target.closest("button");
      if (!button) return;
      state.system = button.getAttribute("data-system");
      Array.prototype.forEach.call(systems.children, function (b) { b.setAttribute("aria-pressed", b === button ? "true" : "false"); });
      render();
    });
    render();
  }

  fetch("data/demo.json").then(function (response) {
    if (!response.ok) throw new Error(response.status);
    return response.json();
  }).then(function (json) { data = json; build(); }).catch(function () {
    root.textContent = "The saved answers could not be loaded. The worked example above shows one of them.";
  });
})();
