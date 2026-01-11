// Schedule Pro (Minute-based) - Ready project
// Features: Drag & Drop, conflict detection, local persistence, import/export, Edugate preloaded catalog.

// Visual order matches the screenshot (Thu → Sun, then time column on the far right)
const DAYS = [
  { key: "thu", ar: "الخميس" },
  { key: "wed", ar: "الأربعاء" },
  { key: "tue", ar: "الثلاثاء" },
  { key: "mon", ar: "الإثنين" },
  { key: "sun", ar: "الأحد" },
];

// Calendar is built on college-style slots (50 min class + 10 min break):
// 07:15–08:05, 08:15–09:05, ...
const SLOT_START_MIN = 7 * 60 + 15;
const SLOT_END_MIN = 20 * 60 + 5; // last visible end label
const SLOT_STEP_MIN = 60;
const SLOT_CLASS_MIN = 50;

const hourH = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--gridHour") || "52", 10);
const pxPerMin = hourH / 60;
const LS_KEY_EVENTS = "schedule_pro_v3_events";

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const state = {
  courses: [],  // [{id,name,code,credits,gender,status,instructor,color,meetings:[{day,startMin,endMin,room}]}]
  events: [],   // [{id,courseId,dayKey,startMin,endMin,room}]
};

function uid(prefix="id"){ return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`; }
function pad2(n){ return String(n).padStart(2,"0"); }
function minToLabel(min){
  const h = Math.floor(min/60);
  const m = min % 60;
  return `${pad2(h)}:${pad2(m)}`;
}
function slotIndexFromY(y){
  return clampInt(Math.floor(y / hourH), 0, slotStarts().length - 1);
}

function clampInt(v, min, max){ return Math.max(min, Math.min(max, v)); }

function slotStarts(){
  const starts = [];
  for(let m = SLOT_START_MIN; m + SLOT_CLASS_MIN <= SLOT_END_MIN; m += SLOT_STEP_MIN){
    starts.push(m);
  }
  return starts;
}

// NOTE: No manual course creation in this build.

function buildCalendar(){
  const cal = $("#calendar");
  cal.innerHTML = "";

  const header = document.createElement("div");
  header.className = "cal-header";
  // Match the screenshot layout: days then time (time column on the far right in RTL UIs)
  header.innerHTML = `
    ${DAYS.map(d => `<div class="hcell">${d.ar}</div>`).join("")}
    <div class="hcell timeHead">الوقت</div>
  `;
  cal.appendChild(header);

  const body = document.createElement("div");
  body.className = "cal-body";

  // day columns
  for(const d of DAYS){
    const col = document.createElement("div");
    col.className = "day-col";
    col.dataset.day = d.key;

    const hint = document.createElement("div");
    hint.className = "drop-hint";
    hint.textContent = "إفلت هنا لإضافة المادة";
    col.appendChild(hint);

    for(const m of slotStarts()){
      const cell = document.createElement("div");
      cell.className = "grid-slot";
      cell.dataset.startMin = String(m);
      col.appendChild(cell);
    }

    col.addEventListener("dragover", (e) => {
      e.preventDefault();
      hint.style.display = "block";
    });
    col.addEventListener("dragleave", () => {
      hint.style.display = "none";
    });
    col.addEventListener("drop", (e) => {
      e.preventDefault();
      hint.style.display = "none";
      const courseId = e.dataTransfer.getData("text/courseId");
      if(!courseId) return;

      const course = state.courses.find(c => c.id === courseId);
      if(!course) return;
      if(String(course.status||"").toLowerCase() === "closed"){
        toast("غير متاح", "هذه الشعبة مقفلة (Closed).");
        return;
      }

      const rect = col.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const idx = slotIndexFromY(y);
      const startMin = slotStarts()[idx];
      const baseMeeting = (course.meetings && course.meetings[0]) ? course.meetings[0] : null;
      const dur = baseMeeting ? Math.max(10, baseMeeting.endMin - baseMeeting.startMin) : SLOT_CLASS_MIN;
      const endMin = Math.min(startMin + dur, SLOT_END_MIN);
      addEvent({ courseId, dayKey: d.key, startMin, endMin, room: baseMeeting?.room || "" });
    });

    body.appendChild(col);
  }

  // time column (right)
  const timeCol = document.createElement("div");
  timeCol.className = "time-col";
  for(const m of slotStarts()){
    const slot = document.createElement("div");
    slot.className = "time-slot";
    slot.innerHTML = `<span>${minToLabel(m)}</span><span>${minToLabel(m + SLOT_CLASS_MIN)}</span>`;
    timeCol.appendChild(slot);
  }
  body.appendChild(timeCol);

  cal.appendChild(body);
}

function clamp(v, min, max){ return Math.max(min, Math.min(max, v)); }

function toast(title, msg){
  let t = document.querySelector(".toast");
  if(!t){
    t = document.createElement("div");
    t.className = "toast";
    document.body.appendChild(t);
  }
  t.innerHTML = `<strong>${escapeHTML(title)}</strong><span>${escapeHTML(msg)}</span>`;
  t.classList.add("show");
  clearTimeout(t._to);
  t._to = setTimeout(()=> t.classList.remove("show"), 2600);
}

function save(){
  // Lock the catalog to college data: only persist the student's schedule events.
  localStorage.setItem(LS_KEY_EVENTS, JSON.stringify({ events: state.events }));
  $("#saveState").textContent = "محلي";
}

function load(){
  const raw = localStorage.getItem(LS_KEY_EVENTS);
  if(!raw) return;
  try{
    const obj = JSON.parse(raw);
    if(obj && Array.isArray(obj.events)) state.events = obj.events;
  }catch{}
}

function dayAr(key){ return DAYS.find(d=>d.key===key)?.ar || key; }

function formatMeetingsBrief(course){
  const ms = course.meetings || [];
  if(ms.length === 0) return "—";
  const parts = ms.slice(0,3).map(m => `${dayAr(m.day)} ${minToLabel(m.startMin)}-${minToLabel(m.endMin)}`);
  return parts.join("، ") + (ms.length > 3 ? " …" : "");
}

function renderCourses(filterText=""){
  const list = $("#courseList");
  list.innerHTML = "";

  const q = filterText.trim().toLowerCase();
  if(!q){
    const empty = document.createElement("div");
    empty.className = "pill";
    empty.style.justifyContent = "center";
    empty.textContent = "اكتب اسم المادة أو الكود في مربع البحث…";
    list.appendChild(empty);
    return;
  }
  const items = state.courses.filter(c => {
    if(!q) return true;
    const hay = `${c.name} ${c.code} ${c.seq||""} ${c.activity||""} ${c.instructor||""} ${c.gender||""} ${c.status||""}`.toLowerCase();
    return hay.includes(q);
  });

  if(items.length === 0){
    const empty = document.createElement("div");
    empty.className = "pill";
    empty.style.justifyContent = "center";
    empty.textContent = "لا توجد نتائج";
    list.appendChild(empty);
    return;
  }

  for(const c of items){
    const card = document.createElement("div");
    card.className = "card";
    card.draggable = true;
    card.dataset.id = c.id;

    card.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/courseId", c.id);
      e.dataTransfer.effectAllowed = "copy";
    });

    const meetingsText = formatMeetingsBrief(c);
    const status = String(c.status || "").trim();
    const statusLower = status.toLowerCase();
    const isClosed = statusLower === "closed";
    if(isClosed){
      card.draggable = false;
      card.style.opacity = "0.55";
      card.style.cursor = "not-allowed";
    }
    const statusChip = status ? (isClosed ? `⛔ ${status}` : `✅ ${status}`) : "—";

    card.innerHTML = `
      <div class="badge" style="background:${c.color || "#38bdf8"}"></div>
      <div class="card-main">
        <div class="card-title">
          <div class="name">${escapeHTML(c.name || "بدون اسم")}</div>
          <div class="code">${escapeHTML(c.code || "")}${c.seq?`-${escapeHTML(c.seq)}`:""}</div>
        </div>
        <div class="card-meta">
          <span title="المواعيد">📅 ${escapeHTML(meetingsText)}</span>
          <span title="المدرس">👤 ${escapeHTML(c.instructor || "—")}</span>
          <span title="الساعات">🧮 ${escapeHTML(String(c.credits || 0))}</span>
          <span title="الحالة">${escapeHTML(statusChip)}</span>
        </div>
      </div>
      <div class="card-actions">
        <button class="icon-btn" title="إضافة للجدول" data-add="1" ${isClosed ? "disabled":""}>＋</button>
      </div>
    `;

    card.addEventListener("click", (e) => {
      const t = e.target;
      if(!(t instanceof HTMLElement)) return;

      if(t.dataset.add){
        if(isClosed){ toast("غير متاح", "هذه الشعبة مقفلة (Closed)."); return; }
        // add all meetings as events
        for(const m of (c.meetings || [])){
          addEvent({ courseId: c.id, dayKey: m.day, startMin: m.startMin, endMin: m.endMin, room: m.room });
        }
      }
    });

    list.appendChild(card);
  }
}

function addEvent({courseId, dayKey, startMin, endMin, room=""}){
  if(startMin >= endMin){ toast("خطأ", "وقت البداية يجب أن يكون أقل من النهاية."); return; }
  const ev = { id: uid("ev"), courseId, dayKey, startMin, endMin, room };
  state.events.push(ev);
  save();
  renderEvents();
}

function deleteCourse(courseId){
  state.courses = state.courses.filter(c => c.id !== courseId);
  state.events = state.events.filter(e => e.courseId !== courseId);
  save();
  computeTotalCredits();
  renderCourses($("#searchBox").value || "");
  renderEvents();
  toast("تم الحذف", "تم حذف المادة وكل حصصها من الجدول.");
}

function deleteEvent(eventId){
  state.events = state.events.filter(e => e.id !== eventId);
  save();
  renderEvents();
}

function renderEvents(){
  $$(".day-col .event").forEach(n => n.remove());

  const conflicts = detectConflicts();
  let conflictCount = 0;

  for(const ev of state.events){
    const course = state.courses.find(c => c.id === ev.courseId);
    if(!course) continue;

    const col = document.querySelector(`.day-col[data-day="${ev.dayKey}"]`);
    if(!col) continue;

    const top = (ev.startMin - SLOT_START_MIN) * pxPerMin;
    const height = Math.max(8, (ev.endMin - ev.startMin) * pxPerMin);

    const el = document.createElement("div");
    el.className = "event";
    el.style.top = `${top}px`;
    el.style.height = `${height}px`;

    const isConflict = conflicts.has(ev.id);
    if(isConflict){
      el.classList.add("conflict");
      conflictCount++;
    }

    const color = course.color || "#38bdf8";

    el.innerHTML = `
      <div class="bar" style="background:${color}"></div>
      <div class="content">
        <div class="name">${escapeHTML(course.name)}</div>
        <div class="sub">
          <span>⏱ ${minToLabel(ev.startMin)} - ${minToLabel(ev.endMin)}</span>
          <span>📍 ${escapeHTML(ev.room || course.room || "—")}</span>
          <span>🏷 ${escapeHTML(course.code || "")}${course.seq?`-${escapeHTML(course.seq)}`:""}</span>
        </div>
      </div>
    `;

    el.addEventListener("click", () => openEventEditor(ev.id));
    col.appendChild(el);
  }

  $("#itemsCount").textContent = String(state.events.length);
  $("#conflictsCount").textContent = String(conflictCount);
}

function detectConflicts(){
  const conflicts = new Set();
  const byDay = new Map();
  for(const ev of state.events){
    if(!byDay.has(ev.dayKey)) byDay.set(ev.dayKey, []);
    byDay.get(ev.dayKey).push(ev);
  }
  for(const arr of byDay.values()){
    arr.sort((a,b)=> a.startMin-b.startMin || a.endMin-b.endMin);
    for(let i=0;i<arr.length;i++){
      for(let j=i+1;j<arr.length;j++){
        const a = arr[i], b = arr[j];
        if(b.startMin >= a.endMin) break;
        conflicts.add(a.id);
        conflicts.add(b.id);
      }
    }
  }
  return conflicts;
}

function openModal({title, bodyNode, actions=[]}){
  $("#modalTitle").textContent = title;
  const mb = $("#modalBody");
  const ma = $("#modalActions");
  mb.innerHTML = "";
  ma.innerHTML = "";
  mb.appendChild(bodyNode);
  for(const a of actions){ ma.appendChild(a); }
  const modal = $("#modal");
  modal.classList.add("show");
  modal.setAttribute("aria-hidden", "false");
}
function closeModal(){
  const modal = $("#modal");
  modal.classList.remove("show");
  modal.setAttribute("aria-hidden", "true");
}

function fillTimeSelect(selectEl, selectedMin, kind){
  selectEl.innerHTML = "";
  const starts = slotStarts();
  const options = (kind === "end")
    ? starts.map(s => s + SLOT_CLASS_MIN).filter(m => m <= SLOT_END_MIN)
    : starts;

  for(const m of options){
    const o = document.createElement("option");
    o.value = String(m);
    o.textContent = minToLabel(m);
    selectEl.appendChild(o);
  }
  // fallback
  const minOpt = options[0] ?? SLOT_START_MIN;
  const maxOpt = options[options.length - 1] ?? SLOT_END_MIN;
  selectEl.value = String(clamp(selectedMin, minOpt, maxOpt));
}

function openEventEditor(eventId){
  const ev = state.events.find(e => e.id === eventId);
  if(!ev) return;
  const course = state.courses.find(c => c.id === ev.courseId);

  const wrap = document.createElement("div");
  wrap.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:10px">
      <div class="pill">المادة: <strong>${escapeHTML(course?.name || "—")}</strong></div>
      <div class="row" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <label class="field">
          <span>من</span>
          <select id="evStart"></select>
        </label>
        <label class="field">
          <span>إلى</span>
          <select id="evEnd"></select>
        </label>
      </div>
      <label class="field">
        <span>المكان</span>
        <input id="evRoom" value="${escapeAttr(ev.room || "")}" />
      </label>
      <div class="pill">اليوم: <strong>${escapeHTML(dayAr(ev.dayKey))}</strong></div>
      <div style="color:rgba(148,163,184,.92);font-size:13px;line-height:1.6">
        سيظهر تعارض باللون الأحمر إذا تداخلت الأوقات مع مادة أخرى.
      </div>
    </div>
  `;

  openModal({
    title: "تعديل الحصة",
    bodyNode: wrap,
    actions: [
      makeBtn("حفظ", "primary", () => {
        const s = parseInt($("#evStart").value,10);
        const e = parseInt($("#evEnd").value,10);
        if(s >= e){ toast("خطأ", "وقت البداية يجب أن يكون أقل من النهاية."); return; }
        ev.startMin = s; ev.endMin = e;
        ev.room = $("#evRoom").value.trim();
        save();
        renderEvents();
        closeModal();
      }),
      makeBtn("حذف الحصة", "danger", () => { deleteEvent(eventId); closeModal(); }),
      makeBtn("إلغاء", "ghost", closeModal),
    ]
  });

  fillTimeSelect($("#evStart"), ev.startMin, "start");
  fillTimeSelect($("#evEnd"), ev.endMin, "end");
}

function openCourseEditor(courseId){
  const c = state.courses.find(x => x.id === courseId);
  if(!c) return;

  const wrap = document.createElement("div");
  wrap.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:12px">
      <div class="row" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <label class="field">
          <span>اسم المادة</span>
          <input id="ecName" value="${escapeAttr(c.name)}" />
        </label>
        <label class="field">
          <span>الكود</span>
          <input id="ecCode" value="${escapeAttr(c.code || "")}" />
        </label>
      </div>

      <div class="row" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <label class="field">
          <span>الأستاذ</span>
          <input id="ecIns" value="${escapeAttr(c.instructor||"")}" />
        </label>
        <label class="field">
          <span>الحالة</span>
          <input id="ecStatus" value="${escapeAttr(c.status||"")}" />
        </label>
      </div>

      <div class="row" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <label class="field">
          <span>لون</span>
          <input id="ecColor" type="color" value="${escapeAttr(c.color||"#38bdf8")}" />
        </label>
        <label class="field">
          <span>الساعات</span>
          <input id="ecCred" type="number" min="0" max="8" step="1" value="${escapeAttr(String(c.credits||0))}" />
        </label>
      </div>

      <div style="color:rgba(148,163,184,.92);font-size:13px;line-height:1.6">
        ملاحظة: مواعيد Edugate محفوظة داخل المادة. لإضافة المواعيد للجدول استخدم زر (+) في بطاقة المادة.
      </div>
    </div>
  `;

  openModal({
    title: "تعديل المادة",
    bodyNode: wrap,
    actions: [
      makeBtn("حفظ", "primary", () => {
        c.name = $("#ecName").value.trim() || c.name;
        c.code = $("#ecCode").value.trim() || c.code;
        c.instructor = $("#ecIns").value.trim();
        c.status = $("#ecStatus").value.trim();
        c.color = $("#ecColor").value;
        c.credits = $("#ecCred").value;

        save();
        computeTotalCredits();
        renderCourses($("#searchBox").value || "");
        renderEvents();
        closeModal();
      }),
      makeBtn("حذف المادة", "danger", () => { deleteCourse(courseId); closeModal(); }),
      makeBtn("إلغاء", "ghost", closeModal),
    ]
  });
}

function makeBtn(text, kind, onClick){
  const b = document.createElement("button");
  b.className = `btn ${kind}`;
  b.type = "button";
  b.textContent = text;
  b.addEventListener("click", onClick);
  return b;
}

function escapeHTML(s){
  return String(s ?? "").replace(/[&<>"']/g, m => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[m]));
}
function escapeAttr(s){ return escapeHTML(s).replace(/"/g,"&quot;"); }

function addCourseFromForm(e){
  e.preventDefault();

  const name = $("#courseName").value.trim();
  if(!name){ toast("مطلوب", "اكتب اسم المادة."); return; }

  const code = $("#courseCode").value.trim();
  const room = $("#courseRoom").value.trim();
  const instructor = $("#courseInstructor").value.trim();
  const color = $("#courseColor").value || "#22c55e";
  const credits = $("#courseCredits").value;

  const startH = parseInt($("#startTime").value, 10);
  const endH = parseInt($("#endTime").value, 10);
  if(startH >= endH){ toast("خطأ", "وقت البداية يجب أن يكون أقل من النهاية."); return; }

  const days = $$("#daysPick .chip.active").map(b => b.dataset.day);
  if(days.length === 0){ toast("مطلوب", "اختر يوم واحد على الأقل."); return; }

  const meetings = days.map(d => ({
    day: d,
    startMin: startH*60,
    endMin: endH*60,
    room: room || ""
  }));

  const course = {
    id: uid("c"),
    name,
    code,
    credits,
    instructor,
    status: "Custom",
    color,
    meetings
  };
  state.courses.unshift(course);

  save();
  computeTotalCredits();
  renderCourses($("#searchBox").value || "");

  $("#courseName").value = "";
  $("#courseCode").value = "";
  $("#courseRoom").value = "";
  $("#courseInstructor").value = "";
  $("#courseCredits").value = "";

  toast("تمت الإضافة", "تمت إضافة المادة لقائمة المواد.");
}

function bindDayChips(containerSel){
  $$(containerSel + " .chip").forEach(btn=>{
    btn.addEventListener("click", ()=> btn.classList.toggle("active"));
  });
}

function clearAll(){
  state.events = [];
  save();
  renderEvents();
  toast("تم المسح", "تم مسح الجدول.");
}

function exportJSON(){
  const payload = {
    source: (window.EDUGATE_DATA && window.EDUGATE_DATA.source) ? window.EDUGATE_DATA.source : "College catalog",
    exportedAt: new Date().toISOString(),
    events: state.events
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {type:"application/json"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "schedule.json";
  a.click();
  URL.revokeObjectURL(a.href);
}

function fitView(){
  const first = document.querySelector(".day-col .event");
  if(first) first.scrollIntoView({behavior:"smooth", block:"center"});
  else toast("ملاءمة", "لا توجد حصص للتركيز عليها.");
}

function setupShortcuts(){
  window.addEventListener("keydown", (e)=>{
    const isMac = navigator.platform.toUpperCase().includes("MAC");
    const mod = isMac ? e.metaKey : e.ctrlKey;
    if(mod && e.key.toLowerCase() === "k"){
      e.preventDefault();
      $("#searchBox").focus();
    }
    if(e.key === "Escape"){ closeModal(); }
  });
}

function preloadEdugateCourses(){
  // Read-only catalog: always sourced from the bundled Edugate data.
  if(state.courses && state.courses.length > 0) return;
  if(!window.EDUGATE_DATA || !Array.isArray(window.EDUGATE_DATA.courses)) return;

  const mapped = [];
  // Map Edugate row -> course card
  for(const r of window.EDUGATE_DATA.courses){
    const course = {
      id: r.id || uid("eg"),
      name: r.name,
      code: r.code,
      seq: r.seq,
      activity: r.activity,
      credits: r.credits || 0,
      gender: r.gender || "",
      status: r.status || "",
      instructor: r.instructor || "",
      color: "#38bdf8",
      meetings: (r.meetings || []).map(m => ({
        day: m.day,
        startMin: m.startMin,
        endMin: m.endMin,
        room: m.room || ""
      }))
    };
    mapped.push(course);
  }
  state.courses = mapped;
  toast("تم تحميل البيانات", `تم تحميل ${state.courses.length} شعبة من بيانات الكلية.`);
}

function init(){
  buildCalendar();

  $("#btnClear").addEventListener("click", clearAll);
  $("#btnExport").addEventListener("click", exportJSON);
  $("#btnFit").addEventListener("click", fitView);

  $("#modalClose").addEventListener("click", closeModal);
  $("#modal").addEventListener("click", (e)=>{
    const t = e.target;
    if(t instanceof HTMLElement && t.dataset.close) closeModal();
  });

  $("#searchBox").addEventListener("input", (e)=> renderCourses(e.target.value || ""));

  setupShortcuts();

  // Catalog comes from the uploaded Edugate file and is read-only for students.
  preloadEdugateCourses();
  load();
  renderCourses("");
  renderEvents();
}

init();
