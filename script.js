/* =========================================================
   VaultPad — script.js (Locked Login, Clean UI, Mobile-First)
   - App is fully inert until correct PIN is entered
   - Strong modal handling (no ESC/backdrop bypass)
   - Local-only storage for Media (images) + Text notes
   - Default password: "Venus!420"
   - Also accept numeric master PIN "2338346420" for mobile keypad flows
   ========================================================= */

(() => {
  /* --------------------------
     Shortcuts & utils
  --------------------------- */
  const $ = (s, r=document)=>r.querySelector(s);
  const $$ = (s, r=document)=>Array.from(r.querySelectorAll(s));
  const byId = id => document.getElementById(id);
  const sleep = ms => new Promise(r=>setTimeout(r, ms));
  const uid = (p="id") => `${p}_${Math.random().toString(36).slice(2,8)}${Date.now().toString(36)}`;
  const escapeHtml = (s="") => s.replace(/[&<>"]/g, c=>({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;" }[c]));
  const escapeAttr = (s="") => s.replace(/"/g,"&quot;");

  /* --------------------------
     Toasts
  --------------------------- */
  const Toaster = (() => {
    const host = byId("toasts");
    function toast(msg, type="info", ms=2200){
      if (!host) { alert(msg); return; }
      const el = document.createElement("div");
      el.className = `toast ${type}`;
      el.textContent = msg;
      host.appendChild(el);
      const kill = ()=> el.remove();
      setTimeout(kill, ms);
      el.addEventListener("click", kill);
    }
    return { toast };
  })();

  /* --------------------------
     Local Store (simple)
  --------------------------- */
  const Store = {
    get pass(){ return localStorage.getItem("vp_pass") || "Venus!420"; },
    set pass(v){ localStorage.setItem("vp_pass", v); },

    readMedia(){ try { return JSON.parse(localStorage.getItem("vp_media") || "[]"); } catch { return []; } },
    writeMedia(list){ localStorage.setItem("vp_media", JSON.stringify(list)); },

    readText(){ try { return JSON.parse(localStorage.getItem("vp_text") || "[]"); } catch { return []; } },
    writeText(list){ localStorage.setItem("vp_text", JSON.stringify(list)); },

    wipeAll(){
      localStorage.removeItem("vp_media");
      localStorage.removeItem("vp_text");
      localStorage.removeItem("vp_pass");
    }
  };

  /* --------------------------
     App State
  --------------------------- */
  const App = {
    unlocked: false,
    mediaUnlocked: false,
    textUnlocked: false,
    queuedFiles: [],
  };

  // Start fully locked (CSS disables pointer events + blurs app)
  document.body.classList.add("locked");

  // Numeric master PIN to allow entry from numeric-only keypad:
  const MASTER_NUMERIC_PIN = "2338346420";

  /* --------------------------
     Dialog helpers
  --------------------------- */
  function openDialog(id){
    const d = byId(id);
    if (!d.open) d.showModal();
    document.body.classList.add("modal-open");
    return d;
  }
  function closeDialog(id){
    const d = byId(id);
    if (d?.open) d.close();
    // Drop modal-open only if no dialogs remain
    requestAnimationFrame(()=>{
      const anyOpen = $$("dialog").some(el => el.open);
      if (!anyOpen) document.body.classList.remove("modal-open");
    });
  }

  /* --------------------------
     Tabs (gated while locked)
  --------------------------- */
  function initTabs(){
    const tabs = $$(".tabbar .tab");
    const views = {
      media: byId("tab-media"),
      text: byId("tab-text"),
      settings: byId("tab-settings"),
    };

    function setTab(name){
      tabs.forEach((b)=>{
        const on = b.dataset.tab === name;
        b.classList.toggle("is-active", on);
        b.setAttribute("aria-selected", String(on));
      });
      Object.entries(views).forEach(([k,v])=>{
        const on = k === name;
        v.classList.toggle("is-active", on);
        v.hidden = !on;
      });
      byId("route-title").textContent = name === "text" ? "Text Vault" : name[0].toUpperCase()+name.slice(1);
      history.replaceState(null, "", `#/${name}`);
    }

    function requireUnlocked(){
      if (!App.unlocked){
        openDialog("login-modal");
        byId("login-pass").focus();
        return false;
      }
      return true;
    }

    tabs.forEach((btn)=>{
      btn.addEventListener("click", ()=>{
        if (!requireUnlocked()) return;
        setTab(btn.dataset.tab);
      });
    });

    // Initial route
    const initial = (location.hash.replace("#/","") || "media");
    setTab(["media","text","settings"].includes(initial) ? initial : "media");
  }

  /* --------------------------
     Auth (Login + Reauth)
  --------------------------- */
  function initAuth(){
    const loginDlg = byId("login-modal");
    const loginInput = byId("login-pass");
    const loginGo = byId("btn-login-go");

    // No ESC to close login; no accidental cancel
    loginDlg.addEventListener("cancel", (e)=> e.preventDefault());

    openDialog("login-modal");
    // Delay focus to ensure dialog paints first (iOS Safari quirk)
    setTimeout(()=> loginInput.focus(), 30);

    function isValidUnlock(val){
      const v = (val || "").trim();
      // Accept either the stored password OR the numeric master PIN for keypad-only users
      return v === Store.pass || v === MASTER_NUMERIC_PIN;
    }

    function tryUnlock(){
      const raw = loginInput.value;
      const val = (raw || "").trim();
      if (!val || val.length < 4 || val.length > 16){
        Toaster.toast("Enter PIN 4–16 digits", "error");
        return;
      }
      if (isValidUnlock(val)){
        App.unlocked = true;
        document.body.classList.remove("locked");
        closeDialog("login-modal");
        loginInput.value = "";
        Toaster.toast("Vault unlocked","success");
        refreshCounts();
      } else {
        Toaster.toast("Incorrect PIN","error");
        loginInput.select();
      }
    }

    loginGo.addEventListener("click", tryUnlock);
    loginInput.addEventListener("keydown", (e)=>{ if (e.key === "Enter") tryUnlock(); });

    // Reauth (used for opening Hidden Media/Text)
    const reInput = byId("reauth-pass");
    const reGo = byId("btn-reauth-go");

    reGo.addEventListener("click", doReauth);
    reInput.addEventListener("keydown", (e)=>{ if (e.key === "Enter") doReauth(); });

    function doReauth(){
      const v = (reInput.value || "").trim();
      if (isValidUnlock(v)){
        const gate = reInput.dataset.gate || "";
        reInput.value = "";
        closeDialog("reauth-modal");
        if (gate === "media"){ App.mediaUnlocked = true; showHiddenMedia(true); }
        if (gate === "text") { App.textUnlocked  = true; showHiddenText(true); }
        Toaster.toast("Access granted","success");
      } else {
        Toaster.toast("Incorrect password","error");
        reInput.select();
      }
    }

    // Defensive: any stray [data-close="login-modal"] becomes no-op
    $$('[data-close="login-modal"]').forEach(b=>{
      b.addEventListener("click", (e)=> e.preventDefault());
    });
  }

  /* --------------------------
     Media Vault
  --------------------------- */
  function initMedia(){
    const choose = byId("btn-media-choose");
    const upload = byId("btn-media-upload");
    const fileInput = byId("media-file");
    const queued = byId("media-queued");

    choose.addEventListener("click", ()=> fileInput.click());
    fileInput.addEventListener("change", ()=>{
      App.queuedFiles = Array.from(fileInput.files || []);
      queued.textContent = App.queuedFiles.length ? `${App.queuedFiles.length} file(s) ready` : "No files selected";
    });

    upload.addEventListener("click", async ()=>{
      if (!App.unlocked) return gated();
      if (!App.queuedFiles.length) return Toaster.toast("Select photo(s) first","error");

      const list = Store.readMedia();
      for (const f of App.queuedFiles){
        if (!f.type.startsWith("image/")) continue;
        const dataUrl = await compressImageToDataURL(f, 0.85, 1600);
        list.push({
          id: uid("media"),
          dataUrl,
          title: f.name || "Photo",
          createdAt: new Date().toISOString(),
        });
        await sleep(8);
      }
      Store.writeMedia(list);
      App.queuedFiles = [];
      fileInput.value = "";
      queued.textContent = "Uploaded!";
      refreshCounts();
      Toaster.toast("Uploaded to Hidden Media","success");
    });

    byId("btn-open-hidden-media").addEventListener("click", ()=>{
      if (!App.unlocked) return gated();
      if (App.mediaUnlocked) return showHiddenMedia(true);
      openDialog("reauth-modal");
      const input = byId("reauth-pass");
      input.value = "";
      input.dataset.gate = "media";
      setTimeout(()=> input.focus(), 30);
    });

    byId("btn-close-media-reveal").addEventListener("click", ()=> showHiddenMedia(false));

    // photo modal close
    $$("[data-close='photo-modal']").forEach(b => b.addEventListener("click", ()=> closeDialog("photo-modal")));
  }

  function showHiddenMedia(show){
    const area = byId("media-reveal");
    if (show){
      area.hidden = false;
      renderMediaGrid();
    } else {
      App.mediaUnlocked = false;
      area.hidden = true;
    }
  }

  function renderMediaGrid(){
    const grid = byId("media-grid");
    const items = Store.readMedia().slice().reverse();
    if (!items.length){
      grid.innerHTML = `<div class="muted small" style="padding:8px 6px;">No photos yet.</div>`;
      return;
    }
    grid.innerHTML = items.map(i=>`
      <div class="tile" data-id="${i.id}">
        <img alt="${escapeHtml(i.title||"Photo")}" src="${i.dataUrl}" />
      </div>
    `).join("");
    $$("#media-grid .tile").forEach(t => t.addEventListener("click", ()=> openPhoto(t.dataset.id)));
  }

  function openPhoto(id){
    const it = Store.readMedia().find(x=>x.id===id);
    if (!it) return;
    byId("photo-view").src = it.dataUrl;
    openDialog("photo-modal");
  }

  function compressImageToDataURL(file, quality=0.85, maxDim=1600){
    return new Promise((resolve, reject)=>{
      const img = new Image();
      img.onload = ()=>{
        const { width, height } = img;
        const scale = Math.min(1, maxDim / Math.max(width, height));
        const w = Math.round(width*scale), h = Math.round(height*scale);
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        c.getContext("2d").drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL("image/jpeg", quality));
      };
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }

  /* --------------------------
     Text Vault
  --------------------------- */
  function initText(){
    byId("btn-text-upload").addEventListener("click", ()=>{
      if (!App.unlocked) return gated();

      const title = byId("txt-title").value.trim();
      const link  = byId("txt-link").value.trim();
      const body  = byId("txt-body").value.trim();

      if (!title && !body) return Toaster.toast("Add a title or note","error");

      const list = Store.readText();
      list.push({
        id: uid("txt"),
        title: title || "Untitled",
        link: link || "",
        body: body || "",
        createdAt: new Date().toISOString(),
      });
      Store.writeText(list);

      byId("txt-title").value = "";
      byId("txt-link").value = "";
      byId("txt-body").value = "";
      refreshCounts();
      Toaster.toast("Text saved to Hidden","success");
    });

    byId("btn-open-hidden-text").addEventListener("click", ()=>{
      if (!App.unlocked) return gated();
      if (App.textUnlocked) return showHiddenText(true);
      openDialog("reauth-modal");
      const input = byId("reauth-pass");
      input.value = "";
      input.dataset.gate = "text";
      setTimeout(()=> input.focus(), 30);
    });

    byId("btn-close-text-reveal").addEventListener("click", ()=> showHiddenText(false));
  }

  function showHiddenText(show){
    const area = byId("text-reveal");
    if (show){
      area.hidden = false;
      renderTextList();
    } else {
      App.textUnlocked = false;
      area.hidden = true;
    }
  }

  function renderTextList(){
    const ul = byId("text-list");
    const items = Store.readText().slice().reverse();
    if (!items.length){
      ul.innerHTML = `<li class="card"><div class="meta">No notes yet.</div></li>`;
      return;
    }
    ul.innerHTML = items.map(i=>`
      <li class="card" data-id="${i.id}">
        <div class="title">${escapeHtml(i.title)}</div>
        ${i.link ? `<div class="meta"><a href="${escapeAttr(i.link)}" target="_blank" rel="noopener">🔗 ${escapeHtml(i.link)}</a></div>` : ""}
        <div class="meta">${escapeHtml(i.body.slice(0,200))}${i.body.length>200 ? "…" : ""}</div>
        <div class="row wrap" style="margin-top:8px;">
          <button class="btn ghost sm" data-act="view">View</button>
          <button class="btn sm" data-act="copy">Copy</button>
          <button class="btn danger sm" data-act="del">Delete</button>
        </div>
      </li>
    `).join("");

    $$("#text-list [data-act='view']").forEach(b => b.addEventListener("click", e=>{
      const id = e.currentTarget.closest("li").dataset.id;
      viewTextItem(id);
    }));
    $$("#text-list [data-act='copy']").forEach(b => b.addEventListener("click", e=>{
      const id = e.currentTarget.closest("li").dataset.id;
      const item = Store.readText().find(x=>x.id===id);
      const payload = item ? `${item.title}\n${item.link||""}\n\n${item.body}`.trim() : "";
      navigator.clipboard.writeText(payload)
        .then(()=> Toaster.toast("Copied","success"))
        .catch(()=> Toaster.toast("Copy failed","error"));
    }));
    $$("#text-list [data-act='del']").forEach(b => b.addEventListener("click", e=>{
      const id = e.currentTarget.closest("li").dataset.id;
      const list = Store.readText().filter(x=>x.id !== id);
      Store.writeText(list);
      renderTextList();
      refreshCounts();
      Toaster.toast("Deleted","info");
    }));
  }

  function viewTextItem(id){
    const it = Store.readText().find(x=>x.id===id);
    if (!it) return;
    const dlg = document.createElement("dialog");
    dlg.className = "modal";
    dlg.innerHTML = `
      <header class="modal-header">
        <h3>${escapeHtml(it.title)}</h3>
        <div class="spacer"></div>
        <button class="icon-btn" aria-label="Close"><svg><use href="#ic-close"/></svg></button>
      </header>
      <div class="modal-body">
        ${it.link ? `<p><a href="${escapeAttr(it.link)}" target="_blank" rel="noopener">🔗 ${escapeHtml(it.link)}</a></p>` : ""}
        <pre style="white-space:pre-wrap;word-wrap:break-word;margin:0">${escapeHtml(it.body)}</pre>
      </div>
      <footer class="modal-footer">
        <button class="btn ghost">Close</button>
      </footer>
    `;
    document.body.appendChild(dlg);
    dlg.showModal();
    document.body.classList.add("modal-open");
    dlg.querySelectorAll(".icon-btn,.btn.ghost").forEach(x=> x.addEventListener("click", ()=>{
      dlg.close(); dlg.remove();
      // Remove modal-open if no other dialogs remain
      requestAnimationFrame(()=>{
        const anyOpen = $$("dialog").some(el => el.open);
        if (!anyOpen) document.body.classList.remove("modal-open");
      });
    }));
  }

  /* --------------------------
     Settings
  --------------------------- */
  function initSettings(){
    byId("btn-change-pass").addEventListener("click", ()=>{
      if (!App.unlocked) return gated();
      openDialog("pass-modal");
      byId("curr-pass").value = "";
      byId("new-pass").value = "";
      byId("new-pass2").value = "";
      setTimeout(()=> byId("curr-pass").focus(), 30);
    });

    byId("btn-pass-apply").addEventListener("click", ()=>{
      const curr = byId("curr-pass").value.trim();
      const n1 = byId("new-pass").value.trim();
      const n2 = byId("new-pass2").value.trim();
      if (curr !== Store.pass) return Toaster.toast("Current password incorrect","error");
      if (!n1 || n1.length < 4 || n1.length > 16) return Toaster.toast("New password must be 4–16","error");
      if (n1 !== n2) return Toaster.toast("Passwords do not match","error");
      Store.pass = n1;
      closeDialog("pass-modal");
      Toaster.toast("Password updated","success");
    });

    byId("btn-wipe").addEventListener("click", ()=>{
      if (!App.unlocked) return gated();
      openDialog("wipe-modal");
    });
    byId("btn-wipe-cancel").addEventListener("click", ()=> closeDialog("wipe-modal"));
    byId("btn-wipe-confirm").addEventListener("click", ()=>{
      Store.wipeAll();
      closeDialog("wipe-modal");
      App.unlocked = false;
      App.mediaUnlocked = false;
      App.textUnlocked = false;
      byId("media-reveal").hidden = true;
      byId("text-reveal").hidden = true;
      refreshCounts();
      // Back to login — relock UI
      document.body.classList.add("locked");
      openDialog("login-modal");
      setTimeout(()=> byId("login-pass").focus(), 30);
      Toaster.toast("All data wiped","success");
    });

    // Close buttons for default modals
    $$("[data-close]").forEach(btn => btn.addEventListener("click", ()=> closeDialog(btn.dataset.close)));
  }

  /* --------------------------
     Gating helper
  --------------------------- */
  function gated(){
    openDialog("login-modal");
    setTimeout(()=> byId("login-pass").focus(), 30);
    return false;
  }

  /* --------------------------
     Counters
  --------------------------- */
  function refreshCounts(){
    byId("hidden-media-count").textContent = `${Store.readMedia().length} photo(s) stored`;
    byId("hidden-text-count").textContent  = `${Store.readText().length} note(s) stored`;
  }

  /* --------------------------
     Boot
  --------------------------- */
  function boot(){
    initTabs();
    initAuth();
    initMedia();
    initText();
    initSettings();
    refreshCounts();

    // Optional keyboard polish (iOS visual tweaks)
    $$("input, textarea").forEach(el=>{
      el.addEventListener("focus", ()=> document.body.classList.add("kb-open"));
      el.addEventListener("blur",  ()=> document.body.classList.remove("kb-open"));
    });
  }

  document.addEventListener("DOMContentLoaded", boot);
})();