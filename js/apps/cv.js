/**
 * apps/cv.js — CV Builder app
 *
 * Firestore structure:
 *   users/{uid}/cvs/{cvId}  — CV document
 *     title, createdAt, updatedAt, theme, personalInfo, sections[]
 */

import {
    addDoc, updateDoc, deleteDoc,
    onSnapshot, serverTimestamp, query, orderBy
} from "https://www.gstatic.com/firebasejs/11.5.0/firebase-firestore.js";

import { refs }                      from "../db.js";
import { toast, confirm, escHtml }   from "../ui.js";

/* ── Constants ── */
const ACCENT_COLORS = [
    "#2563eb","#7c3aed","#db2777","#dc2626","#d97706",
    "#16a34a","#0891b2","#4f46e5","#64748b","#1a1a1a"
];

const SECTION_LABELS = {
    experience: "Work Experience",
    education:  "Education",
    skills:     "Skills",
    languages:  "Languages",
    projects:   "Projects",
    awards:     "Awards & Certs",
    custom:     "Custom Section",
};

/* ── Module state ── */
let _db, _user;
let _unsub       = null;
let _cvs         = [];
let _currentId   = null;
let _currentCv   = null;
let _selectedSec = null;  // id of selected section
let _dragSrc     = null;  // section id being dragged

/* ── Init (called from app.js once the user is signed in) ── */
export function initCv(db, user) {
    _db   = db;
    _user = user;
    _wireEvents();
    _initThemePicker();
    _initCvs();
}

function _initCvs() {
    if (_unsub) _unsub();
    _unsub = onSnapshot(query(refs.cvs(_db, _user.uid), orderBy("updatedAt", "desc")), snap => {
        _cvs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        _renderCvList();
        if (_currentId) {
            const found = _cvs.find(c => c.id === _currentId);
            if (found) { _currentCv = found; _renderPage(); _renderEditPanel(); }
        }
    });
}

/* ── CV list sidebar ── */
function _renderCvList() {
    const list = document.getElementById("cv-list");
    if (!_cvs.length) {
        list.innerHTML = `<div class="cv-list-empty">No CVs yet.<br>Click + to create one.</div>`;
        return;
    }
    list.innerHTML = _cvs.map(cv => `
        <div class="cv-list-item${cv.id === _currentId ? " active" : ""}" data-id="${cv.id}">
            <svg class="cv-list-item-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
            </svg>
            <span class="cv-list-item-name">${escHtml(cv.title || "Untitled CV")}</span>
            <button class="cv-list-item-menu" data-id="${cv.id}" title="Options">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>
                </svg>
            </button>
        </div>
    `).join("");

    list.querySelectorAll(".cv-list-item").forEach(el => {
        el.addEventListener("click", e => {
            if (e.target.closest(".cv-list-item-menu")) return;
            _selectCv(el.dataset.id);
        });
    });
    list.querySelectorAll(".cv-list-item-menu").forEach(btn => {
        btn.addEventListener("click", e => { e.stopPropagation(); _showItemMenu(btn.dataset.id, btn); });
    });
}

function _showItemMenu(cvId, anchorEl) {
    document.querySelectorAll(".cv-item-context-menu").forEach(m => m.remove());
    const menu = document.createElement("div");
    menu.className = "cv-item-context-menu";
    menu.innerHTML = `
        <button data-action="rename">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            Rename
        </button>
        <button data-action="duplicate">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            Duplicate
        </button>
        <button data-action="delete" class="danger">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
            Delete
        </button>
    `;
    anchorEl.closest(".cv-list-item").appendChild(menu);

    menu.addEventListener("click", e => {
        const action = e.target.closest("[data-action]")?.dataset.action;
        menu.remove();
        if (action === "rename") _renameCv(cvId);
        if (action === "duplicate") _duplicateCv(cvId);
        if (action === "delete") _deleteCv(cvId);
    });

    const close = e => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener("click", close); } };
    setTimeout(() => document.addEventListener("click", close), 0);
}

/* ── CV CRUD ── */
async function _newCv() {
    const cv = _defaultCv("Untitled CV");
    const ref = await addDoc(refs.cvs(_db, _user.uid), {
        ...cv, createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    });
    _selectCv(ref.id);
}

function _defaultCv(title = "Untitled CV") {
    return {
        title,
        theme: { accent: "#2563eb", layout: "classic" },
        personalInfo: {
            fullName: "", jobTitle: "", email: "", phone: "",
            location: "", linkedin: "", github: "", website: "", summary: ""
        },
        sections: [
            { id: _uid(), type: "experience", title: "Work Experience", visible: true, entries: [] },
            { id: _uid(), type: "education",  title: "Education",       visible: true, entries: [] },
            { id: _uid(), type: "skills",     title: "Skills",          visible: true, entries: [] },
        ]
    };
}

function _selectCv(id) {
    _currentId  = id;
    _currentCv  = _cvs.find(c => c.id === id) || null;
    _selectedSec = null;
    if (!_currentCv) return;
    _renderCvList();
    _renderTopbar();
    _renderPage();
    _renderEditPanel();
    document.getElementById("cv-page").style.display = "";
    document.getElementById("cv-add-section-bar").style.display = "";
    document.getElementById("cv-no-selection").style.display = "none";
}

async function _save(patch) {
    if (!_currentId) return;
    await updateDoc(refs.cvDoc(_db, _user.uid, _currentId), {
        ...patch, updatedAt: serverTimestamp()
    });
}

function _renameCv(id) {
    if (id !== _currentId) _selectCv(id);
    const input = document.getElementById("cv-title-input");
    input.focus();
    input.select();
}

async function _duplicateCv(id) {
    const cv = _cvs.find(c => c.id === id);
    if (!cv) return;
    const { id: _x, createdAt: _c, updatedAt: _u, ...rest } = cv;
    await addDoc(refs.cvs(_db, _user.uid), {
        ...rest, title: (rest.title || "Untitled CV") + " (copy)",
        createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    });
    toast("CV duplicated", "success");
}

async function _deleteCv(id) {
    if (!await confirm("Delete this CV? This cannot be undone.")) return;
    await deleteDoc(refs.cvDoc(_db, _user.uid, id));
    if (id === _currentId) {
        _currentId  = null;
        _currentCv  = null;
        _selectedSec = null;
        document.getElementById("cv-page").style.display = "none";
        document.getElementById("cv-add-section-bar").style.display = "none";
        document.getElementById("cv-no-selection").style.display = "";
        _renderEditPanel();
    }
    toast("CV deleted", "success");
}

function _renderTopbar() {
    const input = document.getElementById("cv-title-input");
    input.value = _currentCv?.title || "";
    _syncThemePickerState();
}

/* ── CV page renderer ── */
function _renderPage() {
    const page = document.getElementById("cv-page");
    if (!_currentCv) { page.innerHTML = ""; return; }

    const { theme = {}, personalInfo = {}, sections = [] } = _currentCv;
    const accent  = theme.accent  || "#2563eb";
    const layout  = theme.layout  || "classic";

    page.className = `cv-page layout-${layout}`;
    page.style.setProperty("--cv-accent", accent);

    if (layout === "modern") {
        page.innerHTML = `
            <div class="cv-col-left">
                ${_renderHeaderModern(personalInfo, accent)}
                ${sections.filter(s => s.visible && ["skills","languages"].includes(s.type))
                    .map(s => _renderSection(s, accent, true)).join("")}
            </div>
            <div class="cv-col-right">
                ${sections.filter(s => s.visible && !["skills","languages"].includes(s.type))
                    .map(s => _renderSection(s, accent)).join("")}
            </div>
        `;
    } else {
        page.innerHTML = `
            <div class="cv-section cv-header-section" data-sec="header">
                <div class="cv-section-drag-handle">⠿</div>
                ${_renderHeaderClassic(personalInfo)}
            </div>
            <div class="cv-body">
                ${sections.filter(s => s.visible).map(s => _renderSection(s, accent)).join("")}
            </div>
        `;
    }

    _bindSectionClicks(page);
    _bindDrag(page);
}

function _renderHeaderClassic(p) {
    return `
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:20px">
            <div>
                <div class="cv-header-name">${escHtml(p.fullName) || '<span style="color:#ccc">Your Name</span>'}</div>
                ${p.jobTitle ? `<div class="cv-header-title">${escHtml(p.jobTitle)}</div>` : ""}
                <div class="cv-header-contacts">
                    ${p.email    ? `<span class="cv-header-contact-item">✉ ${escHtml(p.email)}</span>`    : ""}
                    ${p.phone    ? `<span class="cv-header-contact-item">☎ ${escHtml(p.phone)}</span>`    : ""}
                    ${p.location ? `<span class="cv-header-contact-item">⌖ ${escHtml(p.location)}</span>` : ""}
                    ${p.linkedin ? `<span class="cv-header-contact-item">in ${escHtml(p.linkedin)}</span>` : ""}
                    ${p.github   ? `<span class="cv-header-contact-item">⌥ ${escHtml(p.github)}</span>`   : ""}
                    ${p.website  ? `<span class="cv-header-contact-item">⊕ ${escHtml(p.website)}</span>`  : ""}
                </div>
                ${p.summary ? `<div class="cv-summary-text" style="margin-top:12px">${escHtml(p.summary)}</div>` : ""}
            </div>
        </div>
    `;
}

function _renderHeaderModern(p, accent) {
    return `
        <div class="cv-section" data-sec="header" style="color:#fff">
            <div style="font-size:22px;font-weight:700;line-height:1.2">${escHtml(p.fullName) || "Your Name"}</div>
            ${p.jobTitle ? `<div style="font-size:13px;opacity:.8;margin-top:4px">${escHtml(p.jobTitle)}</div>` : ""}
            <div style="margin-top:14px;font-size:11px;opacity:.7;display:flex;flex-direction:column;gap:5px">
                ${p.email    ? `<span>✉ ${escHtml(p.email)}</span>`    : ""}
                ${p.phone    ? `<span>☎ ${escHtml(p.phone)}</span>`    : ""}
                ${p.location ? `<span>⌖ ${escHtml(p.location)}</span>` : ""}
                ${p.linkedin ? `<span>in ${escHtml(p.linkedin)}</span>` : ""}
                ${p.github   ? `<span>⌥ ${escHtml(p.github)}</span>`   : ""}
            </div>
            ${p.summary ? `<div style="margin-top:12px;font-size:12px;opacity:.8;line-height:1.5">${escHtml(p.summary)}</div>` : ""}
        </div>
    `;
}

function _renderSection(sec, accent, sidebarMode = false) {
    const { id, type, title, entries = [] } = sec;
    let content = "";

    if (type === "experience" || type === "projects") {
        content = entries.map(e => `
            <div class="cv-entry">
                <div class="cv-entry-header">
                    <div>
                        <div class="cv-entry-title">${escHtml(e.title || e.role || e.name || "")}</div>
                        <div class="cv-entry-sub">${escHtml(e.subtitle || e.company || e.org || "")}</div>
                    </div>
                    <div class="cv-entry-date">${escHtml(e.startDate || "")}${e.startDate && (e.endDate || e.current) ? " – " : ""}${e.current ? "Present" : escHtml(e.endDate || "")}</div>
                </div>
                ${e.description ? `<div class="cv-entry-desc">${escHtml(e.description)}</div>` : ""}
            </div>
        `).join("");
    } else if (type === "education") {
        content = entries.map(e => `
            <div class="cv-entry">
                <div class="cv-entry-header">
                    <div>
                        <div class="cv-entry-title">${escHtml(e.institution || "")}</div>
                        <div class="cv-entry-sub">${[e.degree, e.field].filter(Boolean).map(escHtml).join(", ")}</div>
                    </div>
                    <div class="cv-entry-date">${escHtml(e.startDate || "")}${e.startDate && (e.endDate || e.current) ? " – " : ""}${e.current ? "Present" : escHtml(e.endDate || "")}</div>
                </div>
                ${e.gpa ? `<div class="cv-entry-sub">GPA: ${escHtml(e.gpa)}</div>` : ""}
                ${e.description ? `<div class="cv-entry-desc">${escHtml(e.description)}</div>` : ""}
            </div>
        `).join("");
    } else if (type === "skills") {
        content = `<div class="cv-skills-list">${entries.map(e =>
            `<span class="cv-skill-tag${e.level ? " with-level" : ""}" ${e.level ? `data-level="${escHtml(e.level)}"` : ""}>${escHtml(e.name)}</span>`
        ).join("")}</div>`;
    } else if (type === "languages") {
        content = entries.map(e =>
            `<div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:5px">
                <span>${escHtml(e.language || "")}</span>
                <span style="color:#888">${escHtml(e.level || "")}</span>
            </div>`
        ).join("");
    } else if (type === "awards") {
        content = entries.map(e => `
            <div class="cv-entry">
                <div class="cv-entry-header">
                    <div class="cv-entry-title">${escHtml(e.name || "")}</div>
                    <div class="cv-entry-date">${escHtml(e.date || "")}</div>
                </div>
                ${e.issuer ? `<div class="cv-entry-sub">${escHtml(e.issuer)}</div>` : ""}
                ${e.description ? `<div class="cv-entry-desc">${escHtml(e.description)}</div>` : ""}
            </div>
        `).join("");
    } else if (type === "custom") {
        content = `<div class="cv-summary-text">${escHtml(entries[0]?.content || "")}</div>`;
    }

    const secStyle = sidebarMode ? 'style="color:#fff"' : "";
    const titleStyle = sidebarMode ? `style="color:rgba(255,255,255,.5)"` : "";

    return `
        <div class="cv-section" data-sec="${id}" draggable="true" ${secStyle}>
            <div class="cv-section-drag-handle">⠿</div>
            <div class="cv-sec-title" ${titleStyle}>${escHtml(title || SECTION_LABELS[type] || type)}</div>
            <div class="cv-section-content">
                ${content || `<div style="color:#bbb;font-size:12px;font-style:italic">No entries yet — click to add</div>`}
            </div>
        </div>
    `;
}

/* ── Section click to select ── */
function _bindSectionClicks(page) {
    page.querySelectorAll(".cv-section[data-sec]").forEach(el => {
        el.addEventListener("click", e => {
            const secId = el.dataset.sec;
            _selectedSec = secId;
            page.querySelectorAll(".cv-section").forEach(s => s.classList.remove("selected"));
            el.classList.add("selected");
            _renderEditPanel();
        });
    });
}

/* ── Drag to reorder sections ── */
function _bindDrag(page) {
    const draggables = page.querySelectorAll(".cv-section[data-sec]");
    draggables.forEach(el => {
        el.addEventListener("dragstart", () => {
            _dragSrc = el.dataset.sec;
            el.classList.add("dragging");
        });
        el.addEventListener("dragend", () => el.classList.remove("dragging"));
        el.addEventListener("dragover", e => { e.preventDefault(); });
        el.addEventListener("drop", e => {
            e.preventDefault();
            if (!_dragSrc || _dragSrc === el.dataset.sec) return;
            const sections = [...(_currentCv.sections || [])];
            const fromIdx = sections.findIndex(s => s.id === _dragSrc);
            const toIdx   = sections.findIndex(s => s.id === el.dataset.sec);
            if (fromIdx < 0 || toIdx < 0) return;
            const [moved] = sections.splice(fromIdx, 1);
            sections.splice(toIdx, 0, moved);
            _currentCv.sections = sections;
            _save({ sections });
            _renderPage();
        });
    });
}

/* ── Right edit panel ── */
function _renderEditPanel() {
    const inner = document.getElementById("cv-edit-panel-inner");
    if (!_currentCv) {
        inner.innerHTML = `<div class="cv-edit-empty"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" opacity=".3"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg><p>Select a CV or create a new one</p></div>`;
        return;
    }
    if (!_selectedSec) {
        inner.innerHTML = `<div class="cv-edit-empty"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" opacity=".3"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg><p>Click a section to edit</p></div>`;
        return;
    }
    if (_selectedSec === "header") {
        inner.innerHTML = _buildHeaderForm(_currentCv.personalInfo || {});
        _bindHeaderForm();
        return;
    }
    const sec = (_currentCv.sections || []).find(s => s.id === _selectedSec);
    if (!sec) return;
    inner.innerHTML = _buildSectionForm(sec);
    _bindSectionForm(sec);
}

/* ── Header form ── */
function _buildHeaderForm(p) {
    return `
        <div class="cv-edit-section-title">
            <span class="cv-edit-section-name">Personal Info</span>
        </div>
        ${_field("Full Name",    "fullName",  p.fullName)}
        ${_field("Job Title",    "jobTitle",  p.jobTitle)}
        ${_field("Email",        "email",     p.email)}
        ${_field("Phone",        "phone",     p.phone)}
        ${_field("Location",     "location",  p.location)}
        ${_field("LinkedIn URL", "linkedin",  p.linkedin)}
        ${_field("GitHub",       "github",    p.github)}
        ${_field("Website",      "website",   p.website)}
        ${_textarea("Summary / About", "summary", p.summary)}
    `;
}

function _bindHeaderForm() {
    const inner = document.getElementById("cv-edit-panel-inner");
    inner.querySelectorAll("[data-field]").forEach(el => {
        el.addEventListener("input", () => {
            if (!_currentCv.personalInfo) _currentCv.personalInfo = {};
            _currentCv.personalInfo[el.dataset.field] = el.value;
            _save({ personalInfo: _currentCv.personalInfo });
            _renderPage();
        });
    });
}

/* ── Section form ── */
function _buildSectionForm(sec) {
    const type    = sec.type;
    const entries = sec.entries || [];

    let entriesHtml = entries.map((e, i) => _buildEntryCard(e, i, type)).join("");

    return `
        <div class="cv-edit-section-title">
            <span class="cv-edit-section-name">${escHtml(sec.title || SECTION_LABELS[type] || type)}</span>
            <div class="cv-edit-section-actions">
                <button class="cv-icon-btn danger" data-action="delete-section" title="Remove section">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                </button>
            </div>
        </div>
        ${_field("Section Title", "sec-title", sec.title || SECTION_LABELS[type])}
        ${type !== "custom" ? `
        <div class="cv-entry-list" id="cv-entry-list">
            ${entriesHtml}
        </div>
        <button class="cv-btn-add-entry" id="cv-btn-add-entry">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Add entry
        </button>` : _textarea("Content", "custom-content", (sec.entries?.[0]?.content || ""))}
    `;
}

function _buildEntryCard(e, i, type) {
    let fields = "";
    if (type === "experience") {
        fields = `
            ${_field("Job Title",    "title",       e.title)}
            ${_field("Company",      "company",     e.company)}
            ${_field("Start Date",   "startDate",   e.startDate, "text", "e.g. Jan 2022")}
            ${_field("End Date",     "endDate",     e.endDate,   "text", "e.g. Dec 2023")}
            <div class="cv-form-check">
                <input type="checkbox" id="cur-${i}" ${e.current ? "checked" : ""} data-field="current">
                <label for="cur-${i}">Currently working here</label>
            </div>
            ${_textarea("Description", "description", e.description)}
        `;
    } else if (type === "education") {
        fields = `
            ${_field("Institution", "institution", e.institution)}
            ${_field("Degree",      "degree",      e.degree)}
            ${_field("Field",       "field",       e.field)}
            ${_field("Start Date",  "startDate",   e.startDate, "text", "e.g. Sep 2018")}
            ${_field("End Date",    "endDate",      e.endDate,   "text", "e.g. Jun 2022")}
            <div class="cv-form-check">
                <input type="checkbox" id="cur-${i}" ${e.current ? "checked" : ""} data-field="current">
                <label for="cur-${i}">Currently studying</label>
            </div>
            ${_field("GPA",         "gpa",         e.gpa)}
            ${_textarea("Additional Info", "description", e.description)}
        `;
    } else if (type === "skills") {
        fields = `
            ${_field("Skill name", "name",  e.name)}
            ${_field("Level (optional)", "level", e.level, "text", "e.g. Advanced")}
        `;
    } else if (type === "languages") {
        fields = `
            ${_field("Language", "language", e.language)}
            ${_field("Level",    "level",    e.level, "text", "e.g. Native, B2")}
        `;
    } else if (type === "projects") {
        fields = `
            ${_field("Project Name", "name",        e.name)}
            ${_field("URL (optional)", "subtitle",  e.subtitle)}
            ${_field("Technologies", "company",     e.company, "text", "e.g. React, Node.js")}
            ${_field("Date",         "startDate",   e.startDate)}
            ${_textarea("Description", "description", e.description)}
        `;
    } else if (type === "awards") {
        fields = `
            ${_field("Award / Certificate", "name",  e.name)}
            ${_field("Issuer",              "issuer", e.issuer)}
            ${_field("Date",                "date",   e.date)}
            ${_textarea("Description", "description", e.description)}
        `;
    }

    const label = e.title || e.name || e.institution || e.language || `Entry ${i + 1}`;
    return `
        <div class="cv-entry-card" data-entry-idx="${i}">
            <div class="cv-entry-card-header" data-toggle>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0"><polyline points="6 9 12 15 18 9"/></svg>
                <span class="cv-entry-card-label">${escHtml(label)}</span>
            </div>
            <div class="cv-entry-card-body closed" data-body>
                <div style="height:10px"></div>
                ${fields}
                <button class="cv-btn-delete-entry" data-delete-entry="${i}">Remove entry</button>
            </div>
        </div>
    `;
}

function _bindSectionForm(sec) {
    const inner = document.getElementById("cv-edit-panel-inner");

    /* Section title */
    const titleInput = inner.querySelector("[data-field='sec-title']");
    if (titleInput) {
        titleInput.addEventListener("input", () => {
            sec.title = titleInput.value;
            _saveCurrentSections();
        });
    }

    /* Delete section */
    inner.querySelector("[data-action='delete-section']")?.addEventListener("click", async () => {
        if (!await confirm("Remove this section?")) return;
        _currentCv.sections = (_currentCv.sections || []).filter(s => s.id !== sec.id);
        _selectedSec = null;
        _save({ sections: _currentCv.sections });
        _renderPage();
        _renderEditPanel();
    });

    /* Custom content */
    const customContent = inner.querySelector("[data-field='custom-content']");
    if (customContent) {
        customContent.addEventListener("input", () => {
            if (!sec.entries) sec.entries = [{}];
            sec.entries[0] = { ...sec.entries[0], content: customContent.value };
            _saveCurrentSections();
        });
    }

    /* Entry card toggles */
    inner.querySelectorAll("[data-toggle]").forEach(header => {
        header.addEventListener("click", () => {
            const body = header.nextElementSibling;
            body.classList.toggle("closed");
        });
    });

    /* Entry field inputs */
    inner.querySelectorAll(".cv-entry-card [data-field]").forEach(el => {
        el.addEventListener("input", () => {
            const card  = el.closest(".cv-entry-card");
            const idx   = parseInt(card.dataset.entryIdx, 10);
            const field = el.dataset.field;
            if (!sec.entries[idx]) sec.entries[idx] = {};
            if (el.type === "checkbox") {
                sec.entries[idx][field] = el.checked;
            } else {
                sec.entries[idx][field] = el.value;
            }
            _saveCurrentSections();
        });
    });

    /* Add entry */
    inner.querySelector("#cv-btn-add-entry")?.addEventListener("click", () => {
        if (!sec.entries) sec.entries = [];
        sec.entries.push({});
        _saveCurrentSections();
        _renderPage();
        _renderEditPanel();
        /* Expand the new card */
        setTimeout(() => {
            const cards = document.querySelectorAll("#cv-entry-list .cv-entry-card");
            const last  = cards[cards.length - 1];
            last?.querySelector("[data-body]")?.classList.remove("closed");
        }, 0);
    });

    /* Delete entry */
    inner.querySelectorAll("[data-delete-entry]").forEach(btn => {
        btn.addEventListener("click", () => {
            const idx = parseInt(btn.dataset.deleteEntry, 10);
            sec.entries.splice(idx, 1);
            _saveCurrentSections();
            _renderPage();
            _renderEditPanel();
        });
    });
}

function _saveCurrentSections() {
    _save({ sections: _currentCv.sections || [] });
    _renderPage();
}

/* ── Add section ── */
function _addSection(type) {
    const sec = {
        id: _uid(), type, visible: true,
        title: SECTION_LABELS[type] || type,
        entries: type === "custom" ? [{ content: "" }] : []
    };
    if (!_currentCv.sections) _currentCv.sections = [];
    _currentCv.sections.push(sec);
    _save({ sections: _currentCv.sections });
    _selectedSec = sec.id;
    _renderPage();
    _renderEditPanel();
}

/* ── Theme ── */
function _initThemePicker() {
    const btn      = document.getElementById("cv-theme-btn");
    const dropdown = document.getElementById("cv-theme-dropdown");
    const grid     = document.getElementById("cv-color-grid");

    /* Color buttons */
    grid.innerHTML = ACCENT_COLORS.map(c => `
        <button class="cv-color-btn${_currentCv?.theme?.accent === c ? " active" : ""}"
            data-color="${c}" style="background:${c}" title="${c}"></button>
    `).join("");

    grid.querySelectorAll(".cv-color-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const color = btn.dataset.color;
            if (!_currentCv) return;
            if (!_currentCv.theme) _currentCv.theme = {};
            _currentCv.theme.accent = color;
            document.getElementById("cv-theme-swatch").style.background = color;
            grid.querySelectorAll(".cv-color-btn").forEach(b => b.classList.toggle("active", b.dataset.color === color));
            _save({ theme: _currentCv.theme });
            _renderPage();
        });
    });

    /* Layout buttons */
    document.getElementById("cv-layout-options").querySelectorAll(".cv-layout-opt").forEach(opt => {
        opt.addEventListener("click", () => {
            if (!_currentCv) return;
            if (!_currentCv.theme) _currentCv.theme = {};
            _currentCv.theme.layout = opt.dataset.layout;
            document.querySelectorAll(".cv-layout-opt").forEach(o => o.classList.toggle("active", o === opt));
            _save({ theme: _currentCv.theme });
            _renderPage();
        });
    });

    /* Toggle dropdown */
    btn.addEventListener("click", e => {
        e.stopPropagation();
        dropdown.classList.toggle("open");
        if (dropdown.classList.contains("open")) _syncThemePickerState();
    });
    document.addEventListener("click", e => {
        if (!dropdown.contains(e.target) && e.target !== btn) dropdown.classList.remove("open");
    });
}

function _syncThemePickerState() {
    if (!_currentCv) return;
    const accent = _currentCv.theme?.accent || "#2563eb";
    const layout = _currentCv.theme?.layout || "classic";
    document.getElementById("cv-theme-swatch").style.background = accent;
    document.querySelectorAll("#cv-color-grid .cv-color-btn").forEach(b => b.classList.toggle("active", b.dataset.color === accent));
    document.querySelectorAll(".cv-layout-opt").forEach(o => o.classList.toggle("active", o.dataset.layout === layout));
}

/* ── PDF Export ── */
async function _exportPdf() {
    if (!_currentCv) return;
    toast("Generating PDF…");
    try {
        /* Lazy-load html2canvas + jsPDF from CDN */
        if (!window.html2canvas) {
            await _loadScript("https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js");
        }
        if (!window.jspdf) {
            await _loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js");
        }

        const page = document.getElementById("cv-page");
        /* Temporarily deselect so outline doesn't show */
        const sel = page.querySelector(".cv-section.selected");
        sel?.classList.remove("selected");

        const canvas = await window.html2canvas(page, {
            scale: 2, useCORS: true, backgroundColor: "#ffffff", logging: false
        });

        sel?.classList.add("selected");

        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF({ unit: "px", format: [794, 1123], orientation: "portrait" });
        pdf.addImage(canvas.toDataURL("image/jpeg", 0.95), "JPEG", 0, 0, 794, 1123);

        const name = (_currentCv.title || "CV").replace(/[^a-z0-9_\- ]/gi, "_");
        pdf.save(`${name}.pdf`);
        toast("PDF downloaded", "success");
    } catch (err) {
        console.error(err);
        toast("PDF export failed", "error");
    }
}

/* ── PDF Import ── */
async function _importPdf(file) {
    toast("Importing PDF…");
    try {
        if (!window.pdfjsLib) {
            await _loadScript("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js");
            window.pdfjsLib.GlobalWorkerOptions.workerSrc =
                "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
        }
        const arrayBuffer = await file.arrayBuffer();
        const pdfDoc = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;

        const lines  = await _extractLinesFromPdf(pdfDoc);
        const parsed = _parseCvText(lines);
        const title  = file.name.replace(/\.pdf$/i, "").replace(/[_-]+/g, " ").trim() || "Imported CV";

        const ref = await addDoc(refs.cvs(_db, _user.uid), {
            ..._defaultCv(title),
            personalInfo: parsed.personalInfo,
            sections:     parsed.sections,
            createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
        });
        _selectCv(ref.id);
        toast("PDF imported — edit your CV below", "success");
    } catch (err) {
        console.error(err);
        toast("Could not import PDF", "error");
    }
}

async function _extractLinesFromPdf(pdfDoc) {
    const allLines = [];
    for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
        const page = await pdfDoc.getPage(pageNum);
        const tc   = await page.getTextContent();

        // Group items by approximate y position (PDF y-axis is bottom-up)
        const byY = new Map();
        for (const item of tc.items) {
            if (!item.str) continue;
            const y = Math.round(item.transform[5] / 3) * 3;
            if (!byY.has(y)) byY.set(y, []);
            byY.get(y).push(item);
        }
        const ys = [...byY.keys()].sort((a, b) => b - a);
        for (const y of ys) {
            const items = byY.get(y).sort((a, b) => a.transform[4] - b.transform[4]);
            const line  = items.map(i => i.str).join(" ").replace(/\s+/g, " ").trim();
            if (line) allLines.push(line);
        }
        allLines.push(""); // blank line between pages
    }
    return allLines;
}

function _parseCvText(lines) {
    const fullText = lines.join("\n");

    // Contact info via regex
    const emailM    = fullText.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i);
    const phoneM    = fullText.match(/(?:\+\d{1,3}[\s\-.()]?)?\(?\d{3,4}\)?[\s\-.]?\d{3,4}[\s\-.]?\d{3,4}/);
    const linkedinM = fullText.match(/linkedin\.com\/in\/([\w%-]+)/i);
    const githubM   = fullText.match(/github\.com\/([\w-]+)/i);
    const websiteM  = fullText.match(/https?:\/\/(?!(?:www\.)?(?:linkedin|github)\.com)[\w./%-]+/i);

    // Known section header patterns
    const KNOWN_SECTION_RE = {
        experience: /^(work\s+)?experience$|^professional\s+experience$|^employment(\s+history)?$|^work\s+history$/i,
        education:  /^education$|^academic\s+(background|history)$|^education\s+[&]\s+training$/i,
        skills:     /^(technical\s+|key\s+|core\s+)?skills?$|^competenc(y|ies)$/i,
        languages:  /^languages?$/i,
        projects:   /^(personal\s+|side\s+)?projects?$/i,
        awards:     /^(awards?\s*[&]\s*)?certifications?$|^awards?$|^achievements?$|^honors?$/i,
        _summary:   /^(professional\s+)?summary$|^profile$|^about(\s+me)?$|^objective$|^career\s+objective$/i,
    };

    const boundaries = [];
    lines.forEach((line, i) => {
        const t = line.trim();
        if (!t || t.length > 70) return;

        // Match known types first
        for (const [type, re] of Object.entries(KNOWN_SECTION_RE)) {
            if (re.test(t)) { boundaries.push({ type, lineIndex: i, title: t }); return; }
        }

        // Treat any short ALL-CAPS line as an unknown section header
        // (common CV formatting convention — e.g. "WORK EXPERIENCE", "VOLUNTEER")
        if (t === t.toUpperCase() && /[A-Z]{2,}/.test(t) && !/[@.\/:\d]/.test(t)
                && t.split(/\s+/).length <= 6) {
            boundaries.push({ type: "custom", lineIndex: i, title: t });
        }
    });

    // Lines before first section = name / job title / contact block
    const firstSecLine = boundaries[0]?.lineIndex ?? lines.length;
    const headerLines  = lines.slice(0, firstSecLine).filter(l => l.trim());
    const contactVals  = [emailM?.[0], linkedinM?.[0], githubM?.[0], phoneM?.[0], websiteM?.[0]]
        .filter(Boolean).map(v => v.toLowerCase());

    const nameLines = headerLines.filter(l => {
        const ll = l.toLowerCase();
        return !contactVals.some(c => ll.includes(c)) &&
               !/@/.test(l) && !/linkedin\.com|github\.com/i.test(l) &&
               !/^\+?[\d\s()\-.]{7,}$/.test(l.trim());
    });

    const fullName = nameLines[0]?.trim() || "";
    const jobTitle = nameLines[1]?.trim() || "";
    // Any remaining header lines (tagline, address, etc.) go into summary
    const headerRest = nameLines.slice(2).join(" ").trim();

    // Summary from a recognised _summary section
    let summary = headerRest;
    const sumB = boundaries.find(b => b.type === "_summary");
    if (sumB) {
        const nextLine = boundaries.find(b => b.lineIndex > sumB.lineIndex)?.lineIndex ?? lines.length;
        const sumText  = lines.slice(sumB.lineIndex + 1, nextLine).filter(Boolean).join(" ").trim();
        summary = [headerRest, sumText].filter(Boolean).join("\n").trim();
    }

    // Build sections (skip _summary — goes into personalInfo)
    const sections = [];
    const realBoundaries = boundaries.filter(b => b.type !== "_summary");
    for (let bi = 0; bi < realBoundaries.length; bi++) {
        const { type, lineIndex, title } = realBoundaries[bi];
        const nextLine     = realBoundaries[bi + 1]?.lineIndex ?? lines.length;
        const sectionLines = lines.slice(lineIndex + 1, nextLine);
        const entries      = _parseEntries(sectionLines, type);
        // Always include the section even if entries is empty — raw text is better than nothing
        if (sectionLines.some(l => l.trim()) || entries.length) {
            sections.push({ id: _uid(), type, title, visible: true, entries });
        }
    }

    const personalInfo = {
        fullName, jobTitle,
        email:    emailM?.[0]         || "",
        phone:    phoneM?.[0]?.trim() || "",
        location: "",
        linkedin: linkedinM ? `linkedin.com/in/${linkedinM[1]}` : "",
        github:   githubM   ? `github.com/${githubM[1]}`        : "",
        website:  websiteM?.[0]       || "",
        summary,
    };

    return { personalInfo, sections: sections.length ? sections : _defaultCv().sections };
}

function _parseEntries(lines, type) {
    if (!lines.length) return [];

    if (type === "skills") {
        return lines.join(", ").split(/[,•·|\/\n]/)
            .map(s => s.replace(/^[\s\-–•*]+/, "").trim())
            .filter(s => s.length > 0 && s.length < 80)
            .map(name => ({ name }));
    }

    if (type === "languages") {
        return lines.filter(Boolean).map(l => {
            const m = l.match(/^([\w\s]+?)(?:[\s]*[-–:]+[\s]*|\s{2,}|\s*\()(.+?)[\)]*$/);
            return m ? { language: m[1].trim(), level: m[2].trim() } : { language: l.trim(), level: "" };
        }).filter(e => e.language.length > 0);
    }

    if (type === "custom") {
        // Preserve all text verbatim in the custom section's content field
        const content = lines.filter(Boolean).join("\n").trim();
        return content ? [{ content }] : [];
    }

    // experience / education / projects / awards:
    // split on blank lines → one entry per block
    const blocks = [];
    let cur = [];
    for (const line of lines) {
        if (!line.trim()) { if (cur.length) { blocks.push(cur); cur = []; } }
        else cur.push(line.trim());
    }
    if (cur.length) blocks.push(cur);

    return blocks.map(block => _parseEntryBlock(block, type));
}

function _parseEntryBlock(block, type) {
    const DATE_RE  = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|\d{4})\b/i;
    const RANGE_RE = /(.+?)\s*[-–—]\s*(present|current|[\w.]+\s+\d{4}|\d{4})/i;

    const first  = block[0] || "";
    const second = block[1] || "";

    let startDate = "", endDate = "", current = false, dateCarrier = "";
    const dateSource = [first, second].find(l => DATE_RE.test(l));
    if (dateSource) {
        dateCarrier = dateSource;
        const m = dateSource.match(RANGE_RE);
        if (m) {
            startDate = m[1].trim();
            if (/present|current/i.test(m[2])) { current = true; }
            else endDate = m[2].trim();
        } else {
            startDate = dateSource.trim();
        }
    }

    if (type === "experience") {
        const titleLine = first === dateCarrier ? second : first;
        const compLine  = (first !== dateCarrier && second !== dateCarrier) ? second : "";
        const atM = titleLine.match(/^(.+?)\s+(?:at|@|\|)\s+(.+)$/i);
        // Everything after title + company + date goes into description
        const used = new Set([titleLine, compLine, dateCarrier].filter(Boolean));
        const description = block.filter(l => !used.has(l)).join("\n").trim();
        return { title: atM ? atM[1].trim() : titleLine, company: atM ? atM[2].trim() : compLine,
                 startDate, endDate, current, description };
    }
    if (type === "education") {
        const instLine = first === dateCarrier ? second : first;
        const degLine  = (first !== dateCarrier && second !== dateCarrier) ? second : "";
        const used = new Set([instLine, degLine, dateCarrier].filter(Boolean));
        const description = block.filter(l => !used.has(l)).join("\n").trim();
        return { institution: instLine, degree: degLine, field: "", startDate, endDate, current, description };
    }
    if (type === "projects") {
        const used = new Set([first, dateCarrier].filter(Boolean));
        return { name: first, subtitle: "", company: "", startDate,
                 description: block.filter(l => !used.has(l)).join("\n").trim() };
    }
    if (type === "awards") {
        const issuer = second !== dateCarrier ? second : "";
        const used   = new Set([first, issuer, dateCarrier].filter(Boolean));
        return { name: first, issuer, date: startDate,
                 description: block.filter(l => !used.has(l)).join("\n").trim() };
    }
    // fallback
    const description = block.slice(1).join("\n").trim();
    return { title: first, description };
}

/* ── Wire up all event listeners ── */
function _wireEvents() {
    /* New CV */
    document.getElementById("cv-new-btn").addEventListener("click", _newCv);

    /* Title input */
    const titleInput = document.getElementById("cv-title-input");
    titleInput.addEventListener("input", () => {
        if (!_currentCv) return;
        _currentCv.title = titleInput.value;
        _save({ title: titleInput.value });
        _renderCvList();
    });

    /* Add section button */
    const addBtn  = document.getElementById("cv-add-section-btn");
    const addMenu = document.getElementById("cv-add-section-menu");
    addBtn.addEventListener("click", e => {
        e.stopPropagation();
        addMenu.classList.toggle("open");
    });
    addMenu.querySelectorAll("[data-type]").forEach(btn => {
        btn.addEventListener("click", () => {
            addMenu.classList.remove("open");
            if (!_currentId) return;
            _addSection(btn.dataset.type);
        });
    });
    document.addEventListener("click", e => {
        if (!addMenu.contains(e.target) && e.target !== addBtn) addMenu.classList.remove("open");
    });

    /* Export PDF */
    document.getElementById("cv-export-btn").addEventListener("click", _exportPdf);

    /* Import PDF */
    document.getElementById("cv-pdf-import").addEventListener("change", e => {
        const file = e.target.files[0];
        if (file) _importPdf(file);
        e.target.value = "";
    });

    /* Click away to deselect section */
    document.getElementById("cv-canvas-wrap").addEventListener("click", e => {
        if (!e.target.closest(".cv-section") && !e.target.closest("#cv-add-section-bar")) {
            document.querySelectorAll(".cv-section.selected").forEach(s => s.classList.remove("selected"));
            _selectedSec = null;
            _renderEditPanel();
        }
    });
}

/* ── Helpers ── */
function _field(label, field, value = "", type = "text", placeholder = "") {
    return `
        <div class="cv-form-group">
            <label class="cv-form-label">${label}</label>
            <input class="cv-form-input" type="${type}" data-field="${field}"
                value="${escHtml(value)}" placeholder="${escHtml(placeholder)}">
        </div>
    `;
}

function _textarea(label, field, value = "") {
    return `
        <div class="cv-form-group">
            <label class="cv-form-label">${label}</label>
            <textarea class="cv-form-textarea" data-field="${field}" rows="4">${escHtml(value)}</textarea>
        </div>
    `;
}

function _uid() {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function _loadScript(src) {
    return new Promise((res, rej) => {
        const s = document.createElement("script");
        s.src = src; s.onload = res; s.onerror = rej;
        document.head.appendChild(s);
    });
}
