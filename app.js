(function () {
  "use strict";

  const STORAGE_KEY = "mes-taches-v1";

  /** @type {{id:string, text:string, done:boolean}[]} */
  let tasks = load();
  let filter = "all";

  // DOM
  const form = document.getElementById("addForm");
  const input = document.getElementById("taskInput");
  const list = document.getElementById("list");
  const empty = document.getElementById("empty");
  const counter = document.getElementById("counter");
  const clearBtn = document.getElementById("clearDone");
  const filters = document.getElementById("filters");
  const dateLabel = document.getElementById("dateLabel");

  // --- Storage ---
  function load() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    } catch (e) {
      return [];
    }
  }
  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
  }

  // --- Actions ---
  function addTask(text) {
    text = text.trim();
    if (!text) return;
    tasks.unshift({ id: String(Date.now()) + Math.random().toString(16).slice(2), text, done: false });
    save();
    render();
  }
  function toggle(id) {
    const t = tasks.find((x) => x.id === id);
    if (t) { t.done = !t.done; save(); render(); }
  }
  function remove(id) {
    tasks = tasks.filter((x) => x.id !== id);
    save();
    render();
  }
  function clearDone() {
    tasks = tasks.filter((x) => !x.done);
    save();
    render();
  }

  // --- Render ---
  const checkSVG =
    '<svg viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function render() {
    const visible = tasks.filter((t) =>
      filter === "active" ? !t.done : filter === "done" ? t.done : true
    );

    list.innerHTML = "";
    visible.forEach((t) => {
      const li = document.createElement("li");
      li.className = "item" + (t.done ? " done" : "");

      const check = document.createElement("div");
      check.className = "check";
      check.innerHTML = checkSVG;
      check.addEventListener("click", () => toggle(t.id));

      const label = document.createElement("span");
      label.className = "label";
      label.textContent = t.text;
      label.addEventListener("click", () => toggle(t.id));

      const del = document.createElement("button");
      del.className = "delete";
      del.innerHTML = "&times;";
      del.setAttribute("aria-label", "Supprimer");
      del.addEventListener("click", () => remove(t.id));

      li.append(check, label, del);
      list.appendChild(li);
    });

    // Empty state
    const noneAtAll = tasks.length === 0;
    const noneInView = visible.length === 0;
    empty.classList.toggle("show", noneInView);
    if (noneAtAll) {
      empty.querySelector("p").textContent = "Aucune tâche";
      empty.querySelector(".empty-emoji").textContent = "📝";
      empty.querySelector("span").textContent = "Ajoute ta première tâche ci-dessus.";
    } else {
      empty.querySelector(".empty-emoji").textContent = "🎉";
      empty.querySelector("p").textContent =
        filter === "done" ? "Rien de terminé" : "Tout est fait !";
      empty.querySelector("span").textContent =
        filter === "done" ? "Coche des tâches pour les voir ici." : "Profite de ta pause.";
    }

    // Counter
    const remaining = tasks.filter((t) => !t.done).length;
    counter.textContent =
      tasks.length === 0
        ? "Aucune tâche"
        : remaining === 0
        ? "Tout est terminé ✓"
        : remaining + (remaining > 1 ? " tâches à faire" : " tâche à faire");

    clearBtn.disabled = !tasks.some((t) => t.done);
  }

  // --- Events ---
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    addTask(input.value);
    input.value = "";
    input.focus();
  });

  clearBtn.addEventListener("click", clearDone);

  filters.addEventListener("click", (e) => {
    const btn = e.target.closest(".filter");
    if (!btn) return;
    filter = btn.dataset.filter;
    [...filters.children].forEach((b) => b.classList.toggle("active", b === btn));
    render();
  });

  // Date label (ex: "lundi 22 juin")
  try {
    dateLabel.textContent = new Date().toLocaleDateString("fr-FR", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
  } catch (e) {}

  render();

  // Register service worker for offline / PWA
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
})();
