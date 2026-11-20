/* Answer explorer: every saved answer of the blind and the development question sets, shown as the assistant
   returned it, with what the scorer made of it. Data: data/demo.json, written by scripts/build_site.py from the
   saved answers. No server, no model calls. */
(function () {
  "use strict";
  var root = document.getElementById("explorer");
  if (!root) return;
  var SYSTEMS = [["ocr_lookup", "ocr_lookup", "no LLM"], ["text_only", "text_only", "LLM, text"], ["full", "full", "LLM, text + drawings"]];
  var state = { set: 0, patent: null, question: null, system: "full" };
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

  function render() {
    var patent = data.sets[state.set].patents[state.patent];
    var question = patent.questions[state.question];
    var answer = question.answers[state.system];
    var out = root.querySelector(".ex-out");
    out.textContent = "";
    out.appendChild(el("div", { class: "qa" }, [el("p", { class: "q", text: question.question }), el("p", { class: "a", text: answer.answer })]));
    out.appendChild(el("p", { class: "ex-verdict" }, answer.verdicts.map(function (bit) {
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
    data.sets[state.set].patents[state.patent].questions.forEach(function (question, i) {
      select.appendChild(el("option", { value: i, text: question.label }));
    });
    state.question = Math.min(3, select.options.length - 1);
    select.value = state.question;
  }

  function fillPatents() {
    var select = root.querySelector("#ex-patent"), set = data.sets[state.set];
    select.textContent = "";
    Object.keys(set.patents).forEach(function (number) {
      select.appendChild(el("option", { value: number, text: "US " + set.patents[number].pretty + " · " + set.patents[number].subject }));
    });
    state.patent = set.start_patent;
    select.value = state.patent;
    fillQuestions();
  }

  function build() {
    var setSelect = el("select", { id: "ex-set" }, data.sets.map(function (set, i) { return el("option", { value: i, text: set.title }); }));
    var patentSelect = el("select", { id: "ex-patent" });
    var questionSelect = el("select", { id: "ex-question" });
    var systems = el("div", { class: "ex-systems", role: "group", "aria-label": "Answer system" }, SYSTEMS.map(function (s) {
      return el("button", { type: "button", "data-system": s[0], "aria-pressed": s[0] === state.system ? "true" : "false",
        html: s[1] + ' <span class="n">' + s[2] + "</span>" });
    }));
    root.textContent = "";
    root.appendChild(el("div", { class: "ex-controls" }, [
      el("label", { for: "ex-set", text: "Set" }), setSelect,
      el("label", { for: "ex-patent", text: "Patent" }), patentSelect,
      el("label", { for: "ex-question", text: "Question" }), questionSelect, systems]));
    root.appendChild(el("div", { class: "ex-out", "aria-live": "polite" }));
    fillPatents();
    setSelect.addEventListener("change", function () { state.set = +setSelect.value; fillPatents(); render(); });
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
