/**
 * PEN-Plus Clinical Resource Hub - Client-side logic
 * Handles data loading, filtering, search, and rendering.
 */

(function () {
  "use strict";

  const DATA_URL = "data/resources.json";

  // State
  let allResources = [];
  let catalog = {};
  let currentFilters = { search: "", category: "", type: "", language: "" };

  // DOM references (set on init)
  let elements = {};

  // --- Data Loading ---

  async function loadData() {
    try {
      const resp = await fetch(DATA_URL);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      catalog = await resp.json();
      allResources = catalog.resources || [];
      return catalog;
    } catch (err) {
      console.error("Failed to load resources:", err);
      return null;
    }
  }

  // --- Filtering ---

  function matchesSearch(resource, query) {
    if (!query) return true;
    const q = query.toLowerCase();
    return (
      resource.name.toLowerCase().includes(q) ||
      resource.category.toLowerCase().includes(q) ||
      resource.subcategory.toLowerCase().includes(q) ||
      resource.path.toLowerCase().includes(q) ||
      resource.type.toLowerCase().includes(q) ||
      resource.language.toLowerCase().includes(q)
    );
  }

  function filterResources() {
    const { search, category, type, language } = currentFilters;
    return allResources.filter((r) => {
      if (!matchesSearch(r, search)) return false;
      if (category && r.category !== category) return false;
      if (type && r.type !== type) return false;
      if (language && r.language !== language) return false;
      return true;
    });
  }

  // --- Rendering ---

  function formatFileSize(bytes) {
    if (!bytes || bytes === 0) return "";
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }

  function formatDate(isoStr) {
    if (!isoStr) return "";
    const d = new Date(isoStr);
    return d.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }

  function formatDateParts(isoStr) {
    if (!isoStr) return { day: "", monthYear: "" };
    const d = new Date(isoStr);
    return {
      day: d.getDate(),
      monthYear: d.toLocaleDateString("en-US", { month: "short", year: "numeric" }),
    };
  }

  function fileIconClass(type) {
    const t = type.toLowerCase();
    if (["pdf"].includes(t)) return "pdf";
    if (["docx", "doc", "google doc"].includes(t)) return "docx";
    if (["pptx", "ppt", "google slides"].includes(t)) return "pptx";
    if (["xlsx", "xls", "google sheet", "csv"].includes(t)) return "xlsx";
    return "default";
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function renderResourceCard(r) {
    const icon = fileIconClass(r.type);
    const size = formatFileSize(r.size);
    const date = formatDate(r.modifiedTime);

    return `
      <div class="resource-card" data-id="${escapeHtml(r.id)}">
        <div class="card-header">
          <div class="file-icon ${icon}">${escapeHtml(r.type)}</div>
          <div class="card-title">
            <a href="${escapeHtml(r.link)}" target="_blank" rel="noopener">${escapeHtml(r.name)}</a>
          </div>
        </div>
        <div class="card-meta">
          <span class="badge badge-category">${escapeHtml(r.category)}</span>
          <span class="badge badge-type">${escapeHtml(r.type)}</span>
          <span class="badge badge-language">${escapeHtml(r.language)}</span>
        </div>
        ${r.path ? `<div class="card-path">${escapeHtml(r.path)}</div>` : ""}
        <div class="card-footer">
          <span>${date}</span>
          <span>${size}</span>
        </div>
      </div>`;
  }

  function renderGrid(resources) {
    const grid = elements.resourceGrid;
    if (!grid) return;

    if (resources.length === 0) {
      grid.innerHTML = `
        <div class="empty-state" style="grid-column: 1/-1;">
          <h3>No resources found</h3>
          <p>Try adjusting your search or filters.</p>
        </div>`;
      return;
    }

    grid.innerHTML = resources.map(renderResourceCard).join("");
  }

  function renderStats(filtered) {
    const el = elements.statsCount;
    if (el) {
      el.innerHTML = `Showing <strong>${filtered.length}</strong> of <strong>${allResources.length}</strong> resources`;
    }
    const syncEl = elements.syncInfo;
    if (syncEl && catalog.lastSync) {
      syncEl.textContent = `Last synced: ${formatDate(catalog.lastSync)}`;
    }
  }

  function populateFilters() {
    populateSelect(elements.filterCategory, catalog.categories || []);
    populateSelect(elements.filterType, catalog.types || []);
    populateSelect(elements.filterLanguage, catalog.languages || []);
  }

  function populateSelect(select, options) {
    if (!select) return;
    const defaultText = select.dataset.default || "All";
    select.innerHTML =
      `<option value="">${defaultText}</option>` +
      options.map((o) => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join("");
  }

  // --- Updates Page ---

  function renderUpdateItem(r) {
    const { day, monthYear } = formatDateParts(r.modifiedTime);
    const icon = fileIconClass(r.type);
    const size = formatFileSize(r.size);

    return `
      <div class="update-item">
        <div class="update-date">
          <div class="day">${day}</div>
          <div class="month-year">${escapeHtml(monthYear)}</div>
        </div>
        <div class="file-icon ${icon}">${escapeHtml(r.type)}</div>
        <div class="update-info">
          <div class="card-title">
            <a href="${escapeHtml(r.link)}" target="_blank" rel="noopener">${escapeHtml(r.name)}</a>
          </div>
          <div class="card-meta">
            <span class="badge badge-category">${escapeHtml(r.category)}</span>
            <span class="badge badge-language">${escapeHtml(r.language)}</span>
            <span style="color: var(--text-light); font-size: 12px;">${size}</span>
          </div>
        </div>
      </div>`;
  }

  function renderUpdates(resources) {
    const list = elements.updatesList;
    if (!list) return;

    // Sort by modifiedTime descending
    const sorted = [...resources].sort(
      (a, b) => new Date(b.modifiedTime) - new Date(a.modifiedTime)
    );

    if (sorted.length === 0) {
      list.innerHTML = `
        <div class="empty-state">
          <h3>No recent updates</h3>
          <p>Resources will appear here after the first sync.</p>
        </div>`;
      return;
    }

    list.innerHTML = sorted.map(renderUpdateItem).join("");
  }

  // --- Event Handlers ---

  function onSearchInput(e) {
    currentFilters.search = e.target.value.trim();
    applyFilters();
  }

  function onFilterChange() {
    if (elements.filterCategory) currentFilters.category = elements.filterCategory.value;
    if (elements.filterType) currentFilters.type = elements.filterType.value;
    if (elements.filterLanguage) currentFilters.language = elements.filterLanguage.value;
    applyFilters();
  }

  function onClearFilters() {
    currentFilters = { search: "", category: "", type: "", language: "" };
    if (elements.searchInput) elements.searchInput.value = "";
    if (elements.filterCategory) elements.filterCategory.value = "";
    if (elements.filterType) elements.filterType.value = "";
    if (elements.filterLanguage) elements.filterLanguage.value = "";
    applyFilters();
  }

  function applyFilters() {
    const filtered = filterResources();
    renderGrid(filtered);
    renderStats(filtered);
  }

  // --- Debounce utility ---

  function debounce(fn, delay) {
    let timer;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  // --- Initialization ---

  async function initBrowsePage() {
    elements = {
      resourceGrid: document.getElementById("resource-grid"),
      statsCount: document.getElementById("stats-count"),
      syncInfo: document.getElementById("sync-info"),
      searchInput: document.getElementById("search-input"),
      filterCategory: document.getElementById("filter-category"),
      filterType: document.getElementById("filter-type"),
      filterLanguage: document.getElementById("filter-language"),
      btnClear: document.getElementById("btn-clear"),
      loadingEl: document.getElementById("loading"),
    };

    const data = await loadData();
    if (elements.loadingEl) elements.loadingEl.style.display = "none";

    if (!data) {
      if (elements.resourceGrid) {
        elements.resourceGrid.innerHTML = `
          <div class="empty-state" style="grid-column:1/-1;">
            <h3>Could not load resources</h3>
            <p>Please try refreshing the page.</p>
          </div>`;
      }
      return;
    }

    populateFilters();
    applyFilters();

    // Bind events
    if (elements.searchInput) {
      elements.searchInput.addEventListener("input", debounce(onSearchInput, 200));
    }
    if (elements.filterCategory) elements.filterCategory.addEventListener("change", onFilterChange);
    if (elements.filterType) elements.filterType.addEventListener("change", onFilterChange);
    if (elements.filterLanguage) elements.filterLanguage.addEventListener("change", onFilterChange);
    if (elements.btnClear) elements.btnClear.addEventListener("click", onClearFilters);
  }

  async function initUpdatesPage() {
    elements = {
      updatesList: document.getElementById("updates-list"),
      syncInfo: document.getElementById("sync-info"),
      loadingEl: document.getElementById("loading"),
    };

    const data = await loadData();
    if (elements.loadingEl) elements.loadingEl.style.display = "none";

    if (!data) {
      if (elements.updatesList) {
        elements.updatesList.innerHTML = `
          <div class="empty-state">
            <h3>Could not load resources</h3>
            <p>Please try refreshing the page.</p>
          </div>`;
      }
      return;
    }

    renderUpdates(allResources);

    const syncEl = elements.syncInfo;
    if (syncEl && catalog.lastSync) {
      syncEl.textContent = `Last synced: ${formatDate(catalog.lastSync)}`;
    }
  }

  // Expose init functions globally
  window.ResourceHub = { initBrowsePage, initUpdatesPage };
})();
