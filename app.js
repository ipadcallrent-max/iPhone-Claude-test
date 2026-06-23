/* Flow — Notes & Rappels & To-Do
   PWA statique, vanilla JS. Données en localStorage (schéma versionné). */
(function () {
  "use strict";

  // ---------------------------------------------------------------------------
  // Storage & data model
  // ---------------------------------------------------------------------------
  const KEY = "flow.db.v1";
  const COLORS = ["blue", "purple", "green", "orange", "red", "yellow"];

  const uid = () =>
    Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  function defaultDB() {
    const lPerso = uid(), lTravail = uid(), lCourses = uid();
    const base = new Date(); base.setHours(0, 0, 0, 0); // minuit aujourd'hui
    const at = (offsetH) => new Date(base.getTime() + offsetH * 3600e3).toISOString();
    return {
      v: 1,
      lists: [
        { id: lPerso, name: "Perso", emoji: "🏠", color: "blue" },
        { id: lTravail, name: "Travail", emoji: "💼", color: "purple" },
        { id: lCourses, name: "Courses", emoji: "🛒", color: "green" },
      ],
      items: [
        mkItem({ type: "task", title: "Bienvenue dans Flow 👋", body: "Glisse une carte vers la droite pour la terminer, vers la gauche pour la supprimer. Touche une carte pour la modifier.", listId: lPerso, color: "blue", flagged: true }),
        mkItem({ type: "task", title: "Appeler le dentiste", listId: lPerso, due: at(18), remind: true, priority: 2 }),
        mkItem({ type: "task", title: "Préparer la présentation", listId: lTravail, due: at(34), priority: 3,
          checklist: [ ck("Plan"), ck("Slides"), ck("Répéter") ] }),
        mkItem({ type: "task", title: "Lait, œufs, café", listId: lCourses, color: "green",
          checklist: [ ck("Lait", true), ck("Œufs"), ck("Café") ] }),
        mkItem({ type: "note", title: "Idées de projet", body: "• Une app de méditation\n• Un journal de gratitude\n• Un tracker d'habitudes", listId: lPerso, color: "yellow", pinned: true }),
      ],
      settings: { theme: "auto", sort: "manual" },
    };
  }

  function mkItem(p) {
    const t = Date.now();
    return {
      id: p.id || uid(),
      type: p.type || "task",
      title: p.title || "",
      body: p.body || "",
      done: !!p.done,
      flagged: !!p.flagged,
      pinned: !!p.pinned,
      priority: p.priority || 0, // 0..3
      due: p.due || null,        // ISO string
      remind: !!p.remind,
      tags: p.tags || [],
      listId: p.listId || null,
      color: p.color || null,
      checklist: p.checklist || [], // [{id,text,done}]
      createdAt: p.createdAt || t,
      updatedAt: p.updatedAt || t,
      order: p.order != null ? p.order : t,
    };
  }
  function ck(text, done) { return { id: uid(), text, done: !!done }; }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return defaultDB();
      const db = JSON.parse(raw);
      if (!db || !Array.isArray(db.items)) return defaultDB();
      db.lists = db.lists || [];
      db.settings = Object.assign({ theme: "auto", sort: "manual" }, db.settings);
      db.items = db.items.map(mkItem); // normalise (migration douce)
      return db;
    } catch (e) {
      console.warn("DB illisible, réinitialisation", e);
      return defaultDB();
    }
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(db)); }
    catch (e) { console.warn("Échec sauvegarde", e); }
  }

  let db = load();

  // ---------------------------------------------------------------------------
  // View state
  // ---------------------------------------------------------------------------
  // current = {kind:'smart', id:'today'|'scheduled'|'all'|'flagged'|'notes'|'done'}
  //         | {kind:'list', id:listId}
  let current = { kind: "smart", id: "today" };
  let searchTerm = "";
  let editingId = null;        // id en cours d'édition (ou null pour nouveau)
  let editDraft = null;        // brouillon de l'item en édition
  let lastDeleted = null;      // pour annuler
  const SMART = [
    { id: "today", name: "Aujourd'hui", emoji: "📅", cls: "today" },
    { id: "scheduled", name: "Programmés", emoji: "🗓️", cls: "scheduled" },
    { id: "all", name: "Tout", emoji: "📥", cls: "all" },
    { id: "flagged", name: "Drapeau", emoji: "🚩", cls: "flagged" },
    { id: "notes", name: "Notes", emoji: "📝", cls: "notes" },
    { id: "done", name: "Terminés", emoji: "✅", cls: "done" },
  ];

  // ---------------------------------------------------------------------------
  // Date helpers
  // ---------------------------------------------------------------------------
  const startOfDay = (d) => { const x = new Date(d); x.setHours(0,0,0,0); return x; };
  function isToday(iso) {
    if (!iso) return false;
    const d = startOfDay(new Date(iso)), t = startOfDay(new Date());
    return d.getTime() === t.getTime();
  }
  function isOverdue(item) {
    return item.due && !item.done && new Date(item.due).getTime() < Date.now();
  }
  function fmtDue(iso) {
    const d = new Date(iso), now = new Date();
    const sd = startOfDay(d), st = startOfDay(now);
    const dayDiff = Math.round((sd - st) / 86400e3);
    const hasTime = d.getHours() || d.getMinutes();
    const time = hasTime ? d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "";
    let day;
    if (dayDiff === 0) day = "Auj.";
    else if (dayDiff === 1) day = "Demain";
    else if (dayDiff === -1) day = "Hier";
    else if (dayDiff > 1 && dayDiff < 7) day = d.toLocaleDateString("fr-FR", { weekday: "short" });
    else day = d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
    return time ? `${day} ${time}` : day;
  }

  // ---------------------------------------------------------------------------
  // Filtering / sorting
  // ---------------------------------------------------------------------------
  function matchesView(item) {
    switch (current.kind) {
      case "list": return item.listId === current.id;
      case "smart":
        switch (current.id) {
          case "today": return item.type === "task" && !item.done && isToday(item.due);
          case "scheduled": return item.type === "task" && !item.done && !!item.due;
          case "all": return !item.done;
          case "flagged": return item.flagged && !item.done;
          case "notes": return item.type === "note";
          case "done": return item.done;
        }
    }
    return false;
  }

  function matchesSearch(item) {
    if (!searchTerm) return true;
    const q = searchTerm.toLowerCase();
    const inChecklist = item.checklist.some((c) => c.text.toLowerCase().includes(q));
    const inTags = item.tags.some((t) => t.toLowerCase().includes(q));
    return (
      item.title.toLowerCase().includes(q) ||
      item.body.toLowerCase().includes(q) ||
      inChecklist || inTags
    );
  }

  function visibleItems() {
    let arr = db.items.filter((i) => matchesView(i) && matchesSearch(i));
    const sort = db.settings.sort;
    arr.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      if (sort === "due") {
        const ad = a.due ? new Date(a.due).getTime() : Infinity;
        const bd = b.due ? new Date(b.due).getTime() : Infinity;
        if (ad !== bd) return ad - bd;
      } else if (sort === "priority") {
        if (a.priority !== b.priority) return b.priority - a.priority;
      } else if (sort === "alpha") {
        const c = a.title.localeCompare(b.title, "fr");
        if (c) return c;
      } else if (sort === "created") {
        return b.createdAt - a.createdAt;
      }
      return a.order - b.order; // manual / fallback
    });
    return arr;
  }

  function listById(id) { return db.lists.find((l) => l.id === id); }

  // ---------------------------------------------------------------------------
  // CRUD actions
  // ---------------------------------------------------------------------------
  function upsertItem(item) {
    item.updatedAt = Date.now();
    const idx = db.items.findIndex((i) => i.id === item.id);
    if (idx >= 0) db.items[idx] = item; else db.items.unshift(item);
    save();
    scheduleReminder(item);
  }
  function deleteItem(id, { undoable = true } = {}) {
    const idx = db.items.findIndex((i) => i.id === id);
    if (idx < 0) return;
    const [removed] = db.items.splice(idx, 1);
    save();
    if (undoable) {
      lastDeleted = { item: removed, index: idx };
      showToast("Supprimé", "Annuler", () => {
        db.items.splice(Math.min(lastDeleted.index, db.items.length), 0, lastDeleted.item);
        lastDeleted = null; save(); render();
      });
    }
  }
  function toggleDone(id) {
    const it = db.items.find((i) => i.id === id);
    if (!it) return;
    it.done = !it.done;
    it.updatedAt = Date.now();
    save();
  }

  // ---------------------------------------------------------------------------
  // DOM refs
  // ---------------------------------------------------------------------------
  const $ = (sel) => document.querySelector(sel);
  const el = {
    smartGrid: $("#smartGrid"), listMenu: $("#listMenu"),
    items: $("#items"), empty: $("#empty"), emptyTitle: $("#emptyTitle"), emptyText: $("#emptyText"),
    viewTitle: $("#viewTitle"), viewSubtitle: $("#viewSubtitle"),
    sidebar: $("#sidebar"), overlay: $("#overlay"),
    editor: $("#editor"), editorBody: $("#editorBody"), backdrop: $("#backdrop"),
    typeSeg: $("#typeSeg"),
    searchWrap: $("#searchWrap"), searchInput: $("#searchInput"),
    toast: $("#toast"),
    themeLabel: $("#themeLabel"), themeIcon: $("#themeIcon"),
    notifLabel: $("#notifLabel"),
  };

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------
  const CHECK_SVG = '<svg viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function countFor(view) {
    return db.items.filter((i) => {
      const save = current; current = view; const m = matchesView(i); current = save; return m;
    }).length;
  }

  function renderSidebar() {
    // Smart grid
    el.smartGrid.innerHTML = "";
    SMART.forEach((s) => {
      const sel = current.kind === "smart" && current.id === s.id;
      const btn = document.createElement("button");
      btn.className = `smart ${s.cls}${sel ? " sel" : ""}`;
      btn.innerHTML =
        `<div class="s-top"><span class="s-emoji">${s.emoji}</span>` +
        `<span class="s-count">${countFor({ kind: "smart", id: s.id })}</span></div>` +
        `<span class="s-name">${s.name}</span>`;
      btn.addEventListener("click", () => { setView({ kind: "smart", id: s.id }); closeSidebar(); });
      el.smartGrid.appendChild(btn);
    });

    // Lists
    el.listMenu.innerHTML = "";
    db.lists.forEach((l) => {
      const sel = current.kind === "list" && current.id === l.id;
      const li = document.createElement("li");
      li.className = "list-row" + (sel ? " sel" : "");
      const cnt = countFor({ kind: "list", id: l.id });
      li.innerHTML =
        `<span class="l-emoji" style="background:var(--${l.color || "blue"})">${l.emoji}</span>` +
        `<span class="l-name"></span><span class="l-count">${cnt}</span>` +
        `<button class="l-del" aria-label="Supprimer la liste">⋯</button>`;
      li.querySelector(".l-name").textContent = l.name;
      li.addEventListener("click", (e) => {
        if (e.target.closest(".l-del")) return;
        setView({ kind: "list", id: l.id }); closeSidebar();
      });
      li.querySelector(".l-del").addEventListener("click", (e) => {
        e.stopPropagation(); promptDeleteList(l);
      });
      el.listMenu.appendChild(li);
    });
  }

  function viewMeta() {
    if (current.kind === "list") {
      const l = listById(current.id);
      return { title: l ? `${l.emoji} ${l.name}` : "Liste", emptyT: "Liste vide", emptyX: "Ajoute une tâche ou une note avec +." };
    }
    const s = SMART.find((x) => x.id === current.id);
    const map = {
      today: ["Rien pour aujourd'hui 🎉", "Profite de ta journée."],
      scheduled: ["Aucun rappel programmé", "Ajoute une échéance à une tâche."],
      all: ["Boîte vide", "Touche + pour commencer."],
      flagged: ["Aucun drapeau", "Marque une tâche importante d'un drapeau."],
      notes: ["Aucune note", "Capture une idée avec +."],
      done: ["Rien de terminé", "Tes tâches finies apparaîtront ici."],
    };
    return { title: s ? s.name : "Flow", emptyT: map[current.id][0], emptyX: map[current.id][1] };
  }

  function render() {
    renderSidebar();
    const meta = viewMeta();
    el.viewTitle.textContent = searchTerm ? `« ${searchTerm} »` : meta.title;

    const arr = visibleItems();
    el.items.innerHTML = "";

    if (!arr.length) {
      el.empty.hidden = false;
      el.emptyTitle.textContent = searchTerm ? "Aucun résultat" : meta.emptyT;
      el.emptyText.textContent = searchTerm ? "Essaie d'autres mots-clés." : meta.emptyX;
      el.viewSubtitle.textContent = "";
      return;
    }
    el.empty.hidden = true;
    const remaining = arr.filter((i) => !i.done).length;
    el.viewSubtitle.textContent =
      `${arr.length} élément${arr.length > 1 ? "s" : ""}` +
      (remaining && current.id !== "done" ? ` · ${remaining} à faire` : "");

    arr.forEach((item) => el.items.appendChild(renderCard(item)));
  }

  function renderCard(item) {
    const wrap = document.createElement("div");
    wrap.className = "swipe";
    wrap.dataset.id = item.id;
    wrap.innerHTML =
      `<div class="swipe-actions">` +
      `<div class="swipe-act left">✓ Terminer</div>` +
      `<div class="swipe-act right">Supprimer 🗑</div></div>`;

    const card = document.createElement("div");
    card.className = "card" + (item.done ? " done" : "") + (item.color ? ` tint-${item.color}` : "");

    // left glyph
    if (item.type === "task") {
      const chk = document.createElement("div");
      chk.className = "check" + (item.priority ? ` prio-${item.priority}` : "");
      chk.innerHTML = CHECK_SVG;
      chk.addEventListener("click", (e) => { e.stopPropagation(); toggleDone(item.id); render(); });
      card.appendChild(chk);
    } else {
      const g = document.createElement("div");
      g.className = "note-glyph";
      g.textContent = "📝";
      card.appendChild(g);
    }

    // main
    const main = document.createElement("div");
    main.className = "card-main";
    const title = document.createElement("div");
    title.className = "card-title";
    title.textContent = item.title || (item.type === "note" ? "Note sans titre" : "Sans titre");
    main.appendChild(title);

    if (item.body) {
      const body = document.createElement("div");
      body.className = "card-body";
      body.textContent = item.body;
      main.appendChild(body);
    }

    // checklist progress
    if (item.checklist.length) {
      const doneN = item.checklist.filter((c) => c.done).length;
      const bar = document.createElement("div");
      bar.className = "subprogress";
      const i = document.createElement("i");
      i.style.width = Math.round((doneN / item.checklist.length) * 100) + "%";
      bar.appendChild(i);
      main.appendChild(bar);
    }

    // meta chips
    const meta = document.createElement("div");
    meta.className = "meta";
    if (item.due) {
      const c = document.createElement("span");
      c.className = "chip due" + (isOverdue(item) ? " overdue" : "");
      c.textContent = (isOverdue(item) ? "⚠ " : (item.remind ? "🔔 " : "📅 ")) + fmtDue(item.due);
      meta.appendChild(c);
    }
    if (item.flagged) meta.appendChild(chipEl("flag", "🚩"));
    if (item.checklist.length) {
      const doneN = item.checklist.filter((c) => c.done).length;
      meta.appendChild(chipEl("sub", `☑︎ ${doneN}/${item.checklist.length}`));
    }
    if (current.kind !== "list" && item.listId) {
      const l = listById(item.listId);
      if (l) meta.appendChild(chipEl("list", `${l.emoji} ${l.name}`));
    }
    item.tags.forEach((t) => meta.appendChild(chipEl("tag", `#${t}`)));
    if (meta.children.length) main.appendChild(meta);

    card.appendChild(main);
    if (item.pinned) {
      const pin = document.createElement("span");
      pin.className = "pin-dot"; pin.textContent = "📌";
      card.appendChild(pin);
    }

    card.addEventListener("click", () => openEditor(item.id));
    wrap.appendChild(card);
    attachSwipe(wrap, card, item);
    return wrap;
  }
  function chipEl(cls, text) {
    const s = document.createElement("span");
    s.className = "chip " + cls; s.textContent = text; return s;
  }

  // ---------------------------------------------------------------------------
  // Swipe gestures
  // ---------------------------------------------------------------------------
  function attachSwipe(wrap, card, item) {
    let x0 = 0, y0 = 0, dx = 0, dragging = false, decided = false, horizontal = false;
    const TH = 70;
    const onStart = (e) => {
      const p = e.touches ? e.touches[0] : e;
      x0 = p.clientX; y0 = p.clientY; dx = 0; dragging = true; decided = false; horizontal = false;
      card.style.transition = "none";
    };
    const onMove = (e) => {
      if (!dragging) return;
      const p = e.touches ? e.touches[0] : e;
      const mx = p.clientX - x0, my = p.clientY - y0;
      if (!decided) {
        if (Math.abs(mx) > 8 || Math.abs(my) > 8) {
          decided = true; horizontal = Math.abs(mx) > Math.abs(my);
        } else return;
      }
      if (!horizontal) { dragging = false; card.style.transform = ""; return; }
      if (e.cancelable) e.preventDefault();
      dx = mx;
      card.style.transform = `translateX(${dx}px)`;
    };
    const onEnd = () => {
      if (!dragging) return;
      dragging = false;
      card.style.transition = "transform .2s";
      if (dx > TH) {            // swipe right → terminer
        card.style.transform = "translateX(0)";
        toggleDone(item.id); render();
      } else if (dx < -TH) {    // swipe left → supprimer
        card.style.transform = `translateX(-120%)`;
        setTimeout(() => { deleteItem(item.id); render(); }, 160);
      } else {
        card.style.transform = "translateX(0)";
      }
    };
    card.addEventListener("touchstart", onStart, { passive: true });
    card.addEventListener("touchmove", onMove, { passive: false });
    card.addEventListener("touchend", onEnd);
  }

  // ---------------------------------------------------------------------------
  // Editor sheet
  // ---------------------------------------------------------------------------
  function openEditor(id) {
    if (id) {
      const it = db.items.find((i) => i.id === id);
      if (!it) return;
      editingId = id;
      editDraft = JSON.parse(JSON.stringify(it));
    } else {
      editingId = null;
      const listId = current.kind === "list" ? current.id : (db.lists[0] && db.lists[0].id) || null;
      editDraft = mkItem({ type: current.id === "notes" ? "note" : "task", listId });
    }
    buildEditor();
    el.backdrop.hidden = false;
    el.editor.hidden = false;
  }
  function closeEditor() {
    el.editor.hidden = true; el.backdrop.hidden = true;
    editingId = null; editDraft = null;
  }
  function saveEditor() {
    if (!editDraft) return;
    const title = (editDraft.title || "").trim();
    const hasContent = title || editDraft.body.trim() || editDraft.checklist.some((c) => c.text.trim());
    if (!hasContent) { closeEditor(); return; } // rien à enregistrer
    // nettoie checklist vide
    editDraft.checklist = editDraft.checklist.filter((c) => c.text.trim());
    upsertItem(editDraft);
    closeEditor();
    render();
  }

  function setType(type) {
    editDraft.type = type;
    el.typeSeg.querySelectorAll(".seg-btn").forEach((b) =>
      b.classList.toggle("active", b.dataset.type === type));
    buildEditor();
  }

  function buildEditor() {
    // type segment state
    el.typeSeg.querySelectorAll(".seg-btn").forEach((b) =>
      b.classList.toggle("active", b.dataset.type === editDraft.type));

    const d = editDraft;
    const b = el.editorBody;
    b.innerHTML = "";

    // Title
    b.appendChild(field("",
      input("title-input input", d.title, "Titre", (v) => (d.title = v))));

    // Body
    const ta = document.createElement("textarea");
    ta.className = "textarea";
    ta.placeholder = d.type === "note" ? "Écris ta note…" : "Notes, détails…";
    ta.value = d.body;
    ta.addEventListener("input", () => (d.body = ta.value));
    b.appendChild(field(d.type === "note" ? "Contenu" : "Détails", ta));

    // List + tags row
    const listSel = document.createElement("select");
    listSel.className = "input";
    listSel.innerHTML = `<option value="">— Aucune liste —</option>` +
      db.lists.map((l) => `<option value="${l.id}">${l.emoji} ${escapeAttr(l.name)}</option>`).join("");
    listSel.value = d.listId || "";
    listSel.addEventListener("change", () => (d.listId = listSel.value || null));

    const tagsIn = input("input", d.tags.join(", "), "ex : urgent, perso", (v) =>
      (d.tags = v.split(",").map((s) => s.trim().replace(/^#/, "")).filter(Boolean)));

    const row = document.createElement("div"); row.className = "row";
    row.appendChild(field("Liste", listSel));
    row.appendChild(field("Tags", tagsIn));
    b.appendChild(row);

    if (d.type === "task") {
      // Échéance : un seul champ date+heure (rendu natif propre sur iOS)
      const dtIn = document.createElement("input");
      dtIn.type = "datetime-local"; dtIn.className = "input";
      dtIn.value = d.due ? toLocalInput(new Date(d.due)) : "";
      dtIn.addEventListener("change", () => {
        d.due = dtIn.value ? new Date(dtIn.value).toISOString() : null;
      });
      const dueField = field("Échéance (date et heure)", dtIn);
      // bouton "effacer" l'échéance
      const clr = document.createElement("button");
      clr.type = "button"; clr.className = "clear-due";
      clr.textContent = "Effacer l'échéance";
      clr.addEventListener("click", () => { d.due = null; dtIn.value = ""; });
      dueField.appendChild(clr);
      b.appendChild(dueField);

      // Reminder + flag + pin toggles
      b.appendChild(toggleRow("🔔 Me rappeler", d.remind, (v) => {
        d.remind = v; if (v) ensureNotifPermission();
      }));
      b.appendChild(toggleRow("🚩 Drapeau (important)", d.flagged, (v) => (d.flagged = v)));
      b.appendChild(toggleRow("📌 Épingler en haut", d.pinned, (v) => (d.pinned = v)));

      // Priority
      const pr = document.createElement("div"); pr.className = "prio-seg";
      ["Aucune", "Basse", "Moyenne", "Haute"].forEach((lab, i) => {
        const o = document.createElement("button");
        o.type = "button";
        o.className = "prio-opt" + (d.priority === i ? " sel" : "");
        o.textContent = lab;
        o.addEventListener("click", () => {
          d.priority = i;
          pr.querySelectorAll(".prio-opt").forEach((x, j) => x.classList.toggle("sel", j === i));
        });
        pr.appendChild(o);
      });
      b.appendChild(field("Priorité", pr));

      // Checklist
      b.appendChild(buildChecklist(d));
    } else {
      b.appendChild(toggleRow("📌 Épingler en haut", d.pinned, (v) => (d.pinned = v)));
      b.appendChild(toggleRow("🚩 Drapeau (important)", d.flagged, (v) => (d.flagged = v)));
    }

    // Color
    const cs = document.createElement("div"); cs.className = "color-seg";
    const none = document.createElement("button");
    none.type = "button";
    none.className = "color-dot" + (!d.color ? " sel" : "");
    none.style.background = "var(--separator)";
    none.title = "Aucune";
    none.addEventListener("click", () => { d.color = null; refreshColors(cs, d); });
    cs.appendChild(none);
    COLORS.forEach((c) => {
      const dot = document.createElement("button");
      dot.type = "button";
      dot.className = "color-dot" + (d.color === c ? " sel" : "");
      dot.style.background = `var(--${c})`;
      dot.dataset.color = c;
      dot.addEventListener("click", () => { d.color = c; refreshColors(cs, d); });
      cs.appendChild(dot);
    });
    b.appendChild(field("Couleur", cs));

    // Delete
    if (editingId) {
      const del = document.createElement("button");
      del.className = "danger-btn";
      del.textContent = "Supprimer";
      del.addEventListener("click", () => { deleteItem(editingId); closeEditor(); render(); });
      b.appendChild(del);
    }
  }

  function refreshColors(cs, d) {
    cs.querySelectorAll(".color-dot").forEach((dot) => {
      const c = dot.dataset.color || null;
      dot.classList.toggle("sel", c === (d.color || null));
    });
  }

  function buildChecklist(d) {
    const wrap = document.createElement("div"); wrap.className = "checklist";
    const renderList = () => {
      wrap.innerHTML = "";
      d.checklist.forEach((c, idx) => {
        const row = document.createElement("div"); row.className = "cl-item";
        const chk = document.createElement("div");
        chk.className = "cl-check" + (c.done ? " done" : "");
        chk.innerHTML = c.done ? "✓" : "";
        chk.addEventListener("click", () => { c.done = !c.done; renderList(); });
        const inp = document.createElement("input");
        inp.className = "cl-input"; inp.value = c.text; inp.placeholder = "Sous-tâche";
        inp.addEventListener("input", () => (c.text = inp.value));
        inp.addEventListener("keydown", (e) => {
          if (e.key === "Enter") { e.preventDefault(); addBlank(); }
        });
        const del = document.createElement("button");
        del.className = "cl-del"; del.textContent = "✕";
        del.addEventListener("click", () => { d.checklist.splice(idx, 1); renderList(); });
        row.append(chk, inp, del);
        wrap.appendChild(row);
      });
      const add = document.createElement("button");
      add.className = "cl-add"; add.type = "button";
      add.textContent = "＋ Ajouter une sous-tâche";
      add.addEventListener("click", addBlank);
      wrap.appendChild(add);
    };
    const addBlank = () => {
      d.checklist.push(ck(""));
      renderList();
      const inputs = wrap.querySelectorAll(".cl-input");
      const last = inputs[inputs.length - 1];
      if (last) last.focus();
    };
    renderList();
    return field("Sous-tâches", wrap);
  }

  // editor field helpers
  function field(label, control) {
    const f = document.createElement("div"); f.className = "field";
    if (label) { const l = document.createElement("label"); l.textContent = label; f.appendChild(l); }
    f.appendChild(control);
    return f;
  }
  function input(cls, value, ph, onInput) {
    const i = document.createElement("input");
    i.className = cls; i.value = value || ""; i.placeholder = ph || "";
    i.addEventListener("input", () => onInput(i.value));
    return i;
  }
  function toggleRow(label, checked, onChange) {
    const row = document.createElement("div"); row.className = "toggle-row";
    const lab = document.createElement("span"); lab.className = "tr-label"; lab.textContent = label;
    const sw = document.createElement("label"); sw.className = "switch";
    const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = checked;
    const track = document.createElement("span"); track.className = "track";
    const thumb = document.createElement("span"); thumb.className = "thumb";
    cb.addEventListener("change", () => onChange(cb.checked));
    sw.append(cb, track, thumb);
    row.append(lab, sw);
    return row;
  }

  const toLocalInput = (d) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const pad = (n) => String(n).padStart(2, "0");
  const escapeAttr = (s) => String(s).replace(/"/g, "&quot;").replace(/</g, "&lt;");

  // ---------------------------------------------------------------------------
  // Lists management
  // ---------------------------------------------------------------------------
  function addList() {
    const name = prompt("Nom de la nouvelle liste :");
    if (!name || !name.trim()) return;
    const emojis = ["📚","🎯","✈️","🏋️","🎵","🎨","🍽️","💡","❤️","🌱"];
    const list = {
      id: uid(), name: name.trim(),
      emoji: emojis[Math.floor(Math.random() * emojis.length)],
      color: COLORS[db.lists.length % COLORS.length],
    };
    db.lists.push(list); save();
    setView({ kind: "list", id: list.id });
  }
  function promptDeleteList(l) {
    const n = db.items.filter((i) => i.listId === l.id).length;
    const msg = n
      ? `Supprimer « ${l.name} » et détacher ${n} élément(s) ? (les éléments ne seront pas supprimés)`
      : `Supprimer la liste « ${l.name} » ?`;
    if (!confirm(msg)) return;
    db.items.forEach((i) => { if (i.listId === l.id) i.listId = null; });
    db.lists = db.lists.filter((x) => x.id !== l.id);
    if (current.kind === "list" && current.id === l.id) current = { kind: "smart", id: "today" };
    save(); render();
  }

  // ---------------------------------------------------------------------------
  // Reminders / notifications
  // ---------------------------------------------------------------------------
  const timers = new Map();
  function notifAvailable() { return typeof Notification !== "undefined"; }
  function ensureNotifPermission() {
    if (!notifAvailable()) return Promise.resolve("unsupported");
    if (Notification.permission === "granted") return Promise.resolve("granted");
    if (Notification.permission === "denied") return Promise.resolve("denied");
    return Notification.requestPermission().then((p) => { updateNotifLabel(); return p; });
  }
  function updateNotifLabel() {
    if (!el.notifLabel) return;
    if (!notifAvailable()) { el.notifLabel.textContent = "Rappels non supportés"; return; }
    el.notifLabel.textContent =
      Notification.permission === "granted" ? "Rappels activés ✓"
      : Notification.permission === "denied" ? "Rappels bloqués"
      : "Activer les rappels";
  }
  function scheduleReminder(item) {
    if (timers.has(item.id)) { clearTimeout(timers.get(item.id)); timers.delete(item.id); }
    if (!item.remind || !item.due || item.done) return;
    const delay = new Date(item.due).getTime() - Date.now();
    if (delay <= 0 || delay > 24 * 3600e3) return; // planifie seulement < 24h
    if (!notifAvailable() || Notification.permission !== "granted") return;
    const t = setTimeout(() => fireNotification(item), delay);
    timers.set(item.id, t);
  }
  function scheduleAll() { db.items.forEach(scheduleReminder); }
  function fireNotification(item) {
    try {
      const n = new Notification(item.title || "Rappel", {
        body: item.body || "C'est l'heure !",
        icon: "icon.svg", tag: item.id,
      });
      n.onclick = () => { window.focus(); openEditor(item.id); n.close(); };
    } catch (e) { /* ignore */ }
  }

  // ---------------------------------------------------------------------------
  // Theme
  // ---------------------------------------------------------------------------
  function applyTheme() {
    const t = db.settings.theme || "auto";
    document.documentElement.setAttribute("data-theme", t);
    if (el.themeLabel) el.themeLabel.textContent =
      "Thème : " + ({ auto: "Auto", light: "Clair", dark: "Sombre" }[t]);
    if (el.themeIcon) el.themeIcon.textContent = ({ auto: "🌗", light: "☀️", dark: "🌙" }[t]);
  }
  function cycleTheme() {
    const order = ["auto", "light", "dark"];
    db.settings.theme = order[(order.indexOf(db.settings.theme) + 1) % order.length];
    save(); applyTheme();
  }

  // ---------------------------------------------------------------------------
  // Sort menu
  // ---------------------------------------------------------------------------
  function cycleSort() {
    const order = ["manual", "due", "priority", "alpha", "created"];
    const labels = { manual: "Manuel", due: "Échéance", priority: "Priorité", alpha: "Alphabétique", created: "Récents" };
    db.settings.sort = order[(order.indexOf(db.settings.sort) + 1) % order.length];
    save(); render();
    showToast("Tri : " + labels[db.settings.sort]);
  }

  // ---------------------------------------------------------------------------
  // Toast
  // ---------------------------------------------------------------------------
  let toastTimer = null;
  function showToast(text, actionLabel, action) {
    el.toast.innerHTML = "";
    const span = document.createElement("span"); span.textContent = text;
    el.toast.appendChild(span);
    if (actionLabel) {
      const btn = document.createElement("button");
      btn.textContent = actionLabel;
      btn.addEventListener("click", () => { hideToast(); action && action(); });
      el.toast.appendChild(btn);
    }
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, 4000);
  }
  function hideToast() { el.toast.hidden = true; }

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------
  function setView(v) { current = v; render(); }
  function openSidebar() { el.sidebar.classList.add("open"); el.overlay.hidden = false; }
  function closeSidebar() { el.sidebar.classList.remove("open"); el.overlay.hidden = true; }

  function openSearch() {
    el.searchWrap.hidden = false;
    el.searchInput.value = searchTerm;
    el.searchInput.focus();
  }
  function closeSearch() {
    el.searchWrap.hidden = true; searchTerm = ""; el.searchInput.value = ""; render();
  }

  // ---------------------------------------------------------------------------
  // Wire up events
  // ---------------------------------------------------------------------------
  function bind() {
    $("#openSidebar").addEventListener("click", openSidebar);
    $("#closeSidebar").addEventListener("click", closeSidebar);
    el.overlay.addEventListener("click", closeSidebar);
    $("#addList").addEventListener("click", addList);
    $("#fab").addEventListener("click", () => openEditor(null));
    $("#editorCancel").addEventListener("click", closeEditor);
    $("#editorSave").addEventListener("click", saveEditor);
    el.backdrop.addEventListener("click", closeEditor);
    el.typeSeg.querySelectorAll(".seg-btn").forEach((b) =>
      b.addEventListener("click", () => setType(b.dataset.type)));
    $("#searchBtn").addEventListener("click", openSearch);
    $("#searchCancel").addEventListener("click", closeSearch);
    $("#sortBtn").addEventListener("click", cycleSort);
    el.searchInput.addEventListener("input", () => { searchTerm = el.searchInput.value.trim(); render(); });
    $("#themeToggle").addEventListener("click", cycleTheme);
    $("#notifBtn").addEventListener("click", () =>
      ensureNotifPermission().then((p) => {
        updateNotifLabel();
        if (p === "granted") { scheduleAll(); showToast("Rappels activés ✓"); }
        else if (p === "denied") showToast("Rappels bloqués dans les réglages");
      }));
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { if (!el.editor.hidden) closeEditor(); else if (!el.searchWrap.hidden) closeSearch(); else closeSidebar(); }
    });
    // refresh "today/overdue" once a minute
    setInterval(() => { if (el.editor.hidden) render(); }, 60000);
  }

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------
  function init() {
    applyTheme();
    updateNotifLabel();
    bind();
    if (!localStorage.getItem(KEY)) save(); // persiste les données d'exemple dès le 1er lancement
    render();
    if (notifAvailable() && Notification.permission === "granted") scheduleAll();
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  }

  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", init);
  else init();

  // Expose minimal API for tests (no-op en prod)
  window.__flow = {
    get db() { return db; },
    reset() { db = defaultDB(); save(); render(); },
    setView, openEditor, saveEditor, closeEditor,
    upsertItem, deleteItem, toggleDone, mkItem,
    visibleItems, get current() { return current; }, set current(v) { current = v; },
    set search(v) { searchTerm = v; }, render,
    get editDraft() { return editDraft; },
  };
})();
