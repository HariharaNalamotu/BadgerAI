import { useState } from "react";

const C = {
  bg:           "#0a0a0a",
  sidebar:      "#0f0f0f",
  card:         "#1a1a1a",
  input:        "#1c1c1c",
  border:       "rgba(255,255,255,0.07)",
  borderHover:  "rgba(255,255,255,0.12)",
  text:         "#f0eeea",
  muted:        "#555",
  mid:          "#888",
  accent:       "#f97316",
  accentDim:    "rgba(249,115,22,0.12)",
  accentBorder: "rgba(249,115,22,0.35)",
  success:      "#22c55e",
  warn:         "#f59e0b",
  danger:       "#ef4444",
};

const INIT_WEBSITES = [
  { id:"w1", label:"React Docs",   url:"https://react.dev/reference",  status:"ready",   chunks:4821 },
  { id:"w2", label:"Next.js Docs", url:"https://nextjs.org/docs",      status:"ready",   chunks:2943 },
  { id:"w3", label:"Tauri Guide",  url:"https://tauri.app/v2/guide",   status:"indexing",chunks:0    },
];
const INIT_DOCS = [
  { id:"d1", label:"API Spec v2",   url:"~/Documents/api-spec-v2.pdf",   type:"pdf", status:"ready", chunks:312 },
  { id:"d2", label:"Auth Handbook", url:"~/Documents/auth-handbook.pdf", type:"pdf", status:"ready", chunks:198 },
  { id:"d3", label:"Setup Guide",   url:"~/Documents/setup.md",          type:"md",  status:"ready", chunks:87  },
];
const INIT_CONVS = [
  { id:"c1", title:"useState questions" },
  { id:"c2", title:"App Router setup"   },
  { id:"c3", title:"Auth flow design"   },
];
const MOCK_RESULTS = [
  { id:"r1", rank:1, source:"React Docs",   url:"https://react.dev/reference/react/useState",  score:0.94, content:"useState returns an array with exactly two values: the current state, and the set function that lets you update it to a different value and trigger a re-render." },
  { id:"r2", rank:2, source:"React Docs",   url:"https://react.dev/reference/react/useEffect", score:0.81, content:"useEffect is a React Hook that lets you synchronize a component with an external system. Call useEffect at the top level of your component to declare an effect." },
  { id:"r3", rank:3, source:"Next.js Docs", url:"https://nextjs.org/docs/app/building-your-application/routing", score:0.73, content:"The App Router works in a new directory named app. The app directory works alongside the pages directory to allow incremental adoption." },
];

const mkId = () => Math.random().toString(36).slice(2, 8);

const iBase = {
  width:"100%", boxSizing:"border-box",
  background:"#0f0f0f", border:`1px solid ${C.border}`,
  borderRadius:8, color:C.text, fontSize:13,
  padding:"8px 12px", fontFamily:"inherit", outline:"none",
};

function FInput({ value, onChange, placeholder }) {
  return (
    <input
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      style={iBase}
      onFocus={e => { e.target.style.borderColor = C.accentBorder; }}
      onBlur={e  => { e.target.style.borderColor = C.border; }}
    />
  );
}

function Btn({ children, variant = "ghost", onClick, disabled, style: extra = {} }) {
  const map = {
    primary: { background:C.accent,    border:"none",                        color:"#000", fontWeight:800 },
    outline:  { background:C.accentDim, border:`1px solid ${C.accentBorder}`, color:C.accent, fontWeight:700 },
    ghost:    { background:"transparent", border:`1px solid ${C.border}`,     color:C.mid, fontWeight:400 },
    danger:   { background:"transparent", border:"1px solid rgba(239,68,68,0.3)", color:C.danger },
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{ padding:"6px 14px", borderRadius:8, fontSize:13, cursor:disabled?"not-allowed":"pointer",
               opacity:disabled?0.4:1, fontFamily:"inherit", ...map[variant], ...extra }}>
      {children}
    </button>
  );
}

function Tag({ children }) {
  return (
    <span style={{ fontSize:11, fontWeight:600, color:C.accent, background:C.accentDim,
                   border:`1px solid ${C.accentBorder}`, borderRadius:4, padding:"1px 7px" }}>
      {children}
    </span>
  );
}

function AddModal({ section, onAdd, onClose }) {
  const [url,      setUrl]      = useState("");
  const [label,    setLabel]    = useState("");
  const [docType,  setDocType]  = useState("pdf");
  const isDoc = section === "documentation";

  const handle = () => {
    if (!url.trim()) return;
    onAdd({ label: label.trim() || url.trim(), url: url.trim(), type: isDoc ? docType : "website" });
  };

  return (
    <div
      onClick={onClose}
      style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.82)", zIndex:400,
               display:"flex", alignItems:"center", justifyContent:"center" }}>
      <div
        onClick={e => e.stopPropagation()}
        style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:14, width:440, padding:26 }}>

        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
          <div style={{ fontSize:15, fontWeight:700, color:C.text }}>
            Add {isDoc ? "documentation" : "website"}
          </div>
          <button onClick={onClose}
            style={{ background:"none", border:"none", color:C.mid, cursor:"pointer", fontSize:18, padding:2 }}>
            x
          </button>
        </div>

        {isDoc && (
          <div style={{ marginBottom:16 }}>
            <div style={{ fontSize:12, color:C.muted, marginBottom:8 }}>Type</div>
            <div style={{ display:"flex", gap:6 }}>
              {[["pdf","PDF"],["md","Markdown"],["txt","Plain text"]].map(([v,l]) => (
                <button key={v} onClick={() => setDocType(v)}
                  style={{ flex:1, padding:"6px 0", borderRadius:7,
                           border:`1px solid ${docType===v ? C.accentBorder : C.border}`,
                           background:docType===v ? C.accentDim : "transparent",
                           color:docType===v ? C.accent : C.muted,
                           fontSize:12, cursor:"pointer", fontFamily:"inherit",
                           fontWeight:docType===v ? 600 : 400 }}>
                  {l}
                </button>
              ))}
            </div>
          </div>
        )}

        <div style={{ marginBottom:14 }}>
          <div style={{ fontSize:12, color:C.muted, marginBottom:6 }}>{isDoc ? "File path" : "URL"}</div>
          <FInput value={url} onChange={setUrl}
            placeholder={isDoc ? "~/Documents/my-doc.pdf" : "https://docs.example.com"} />
        </div>

        <div style={{ marginBottom:20 }}>
          <div style={{ fontSize:12, color:C.muted, marginBottom:6 }}>Label (optional)</div>
          <FInput value={label} onChange={setLabel} placeholder="e.g. React Docs" />
        </div>

        {!isDoc && (
          <div style={{ marginBottom:18, padding:"9px 12px", borderRadius:8,
                        background:"rgba(249,115,22,0.06)", border:`1px solid ${C.accentBorder}`,
                        fontSize:12, color:C.mid, lineHeight:1.6 }}>
            plshelp will crawl this site, chunk the content, and build a local index.
          </div>
        )}

        <div style={{ display:"flex", gap:10 }}>
          <Btn variant="ghost" onClick={onClose} style={{ flex:1 }}>Cancel</Btn>
          <Btn variant="primary" onClick={handle} style={{ flex:2 }}>Add {isDoc ? "doc" : "website"}</Btn>
        </div>
      </div>
    </div>
  );
}

function SourceRow({ item, onRemove }) {
  const [hov, setHov] = useState(false);
  const isPdf = item.type === "pdf";
  const iconColor = isPdf ? C.danger : C.mid;
  const iconLabel = isPdf ? "PDF" : item.type === "md" ? "MD" : item.type === "website" ? "WEB" : "DOC";

  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{ display:"flex", alignItems:"center", gap:8, padding:"6px 8px", borderRadius:7,
               marginBottom:1, cursor:"pointer",
               background:hov ? C.accentDim : "transparent" }}>
      <span style={{ fontSize:9, fontWeight:700, color:iconColor,
                     background:`${iconColor}20`, padding:"1px 4px",
                     borderRadius:3, flexShrink:0, fontFamily:"monospace" }}>
        {iconLabel}
      </span>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:12, color:C.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
          {item.label}
        </div>
        <div style={{ fontSize:10, color:item.status==="indexing" ? C.warn : C.muted }}>
          {item.status === "indexing" ? "indexing..." : item.chunks.toLocaleString() + " chunks"}
        </div>
      </div>
      {hov && (
        <button onClick={e => { e.stopPropagation(); onRemove(item.id); }}
          style={{ background:"none", border:"none", color:C.muted, cursor:"pointer",
                   padding:2, fontSize:13, lineHeight:1 }}>
          x
        </button>
      )}
    </div>
  );
}

function SideSection({ title, items, onAdd, onRemove }) {
  const [open, setOpen] = useState(true);
  return (
    <div style={{ marginBottom:4 }}>
      <div
        onClick={() => setOpen(!open)}
        style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
                 padding:"5px 8px", cursor:"pointer" }}>
        <div style={{ display:"flex", alignItems:"center", gap:6 }}>
          <span style={{ fontSize:10, fontWeight:700, color:C.mid,
                         letterSpacing:"0.08em", textTransform:"uppercase" }}>
            {title}
          </span>
          <span style={{ fontSize:10, color:C.muted }}>({items.length})</span>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:4 }}>
          <button
            onClick={e => { e.stopPropagation(); onAdd(); }}
            style={{ background:"none", border:"none", color:C.accent,
                     cursor:"pointer", fontSize:16, padding:"0 2px", lineHeight:1 }}>
            +
          </button>
          <span style={{ fontSize:11, color:C.muted }}>{open ? "▾" : "▸"}</span>
        </div>
      </div>
      {open && (
        <div style={{ paddingLeft:4 }}>
          {items.length === 0 && (
            <div style={{ padding:"8px 8px 10px", fontSize:12, color:C.muted }}>
              No {title.toLowerCase()} yet.{" "}
              <span
                onClick={onAdd}
                style={{ color:C.accent, cursor:"pointer" }}>
                + Add one
              </span>
            </div>
          )}
          {items.map(item => (
            <SourceRow key={item.id} item={item} onRemove={onRemove} />
          ))}
        </div>
      )}
    </div>
  );
}

function ConvItem({ conv, active, onClick, onRename, onDelete }) {
  const [hov,     setHov]     = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft,   setDraft]   = useState(conv.title);

  const commit = () => { onRename(draft.trim() || conv.title); setEditing(false); };

  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      onClick={onClick}
      style={{ display:"flex", alignItems:"center", gap:7, padding:"7px 8px", borderRadius:7,
               marginBottom:2, cursor:"pointer",
               background:active ? C.accentDim : hov ? "rgba(255,255,255,0.03)" : "transparent",
               border:`1px solid ${active ? C.accentBorder : "transparent"}` }}>
      <span style={{ color:active ? C.accent : C.muted, fontSize:11, flexShrink:0 }}>[ ]</span>
      {editing ? (
        <input
          value={draft}
          autoFocus
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => { if (e.key==="Enter") commit(); if (e.key==="Escape") setEditing(false); }}
          onClick={e => e.stopPropagation()}
          style={{ flex:1, background:"#111", border:`1px solid ${C.accentBorder}`,
                   borderRadius:5, color:C.text, fontSize:12,
                   padding:"2px 6px", fontFamily:"inherit", outline:"none" }}
        />
      ) : (
        <span style={{ flex:1, fontSize:12, color:active ? C.accent : C.text,
                       overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
                       fontWeight:active ? 700 : 400 }}>
          {conv.title}
        </span>
      )}
      {hov && !editing && (
        <div style={{ display:"flex", gap:2 }} onClick={e => e.stopPropagation()}>
          <button onClick={() => setEditing(true)}
            style={{ background:"none", border:"none", color:C.muted, cursor:"pointer",
                     fontSize:11, padding:2 }}>
            ~
          </button>
          <button onClick={onDelete}
            style={{ background:"none", border:"none", color:C.muted, cursor:"pointer",
                     fontSize:11, padding:2 }}>
            x
          </button>
        </div>
      )}
    </div>
  );
}

function ResultCard({ result, showTrace }) {
  const [traceOpen, setTraceOpen] = useState(false);
  return (
    <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:10,
                  padding:"14px 16px", marginBottom:10 }}>
      <div style={{ display:"flex", gap:10 }}>
        <div style={{ width:22, height:22, borderRadius:5, background:C.accentDim,
                      border:`1px solid ${C.accentBorder}`,
                      display:"flex", alignItems:"center", justifyContent:"center",
                      fontSize:11, fontWeight:700, color:C.accent, flexShrink:0 }}>
          {result.rank}
        </div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap", marginBottom:6 }}>
            <Tag>{result.source}</Tag>
            <span style={{ fontSize:11, color:C.muted, overflow:"hidden",
                           textOverflow:"ellipsis", whiteSpace:"nowrap", maxWidth:240 }}>
              {result.url}
            </span>
            <span style={{ marginLeft:"auto", fontSize:12, fontWeight:700, color:C.accent, flexShrink:0 }}>
              {Math.round(result.score * 100)}%
            </span>
          </div>
          <p style={{ margin:"0 0 10px", fontSize:13, color:C.text, lineHeight:1.7 }}>
            {result.content}
          </p>
          {showTrace && traceOpen && (
            <div style={{ background:"#0f0f0f", borderRadius:7, padding:"10px 12px",
                          marginBottom:10, border:`1px solid ${C.border}` }}>
              <div style={{ fontSize:10, fontWeight:700, color:C.mid, marginBottom:8,
                            letterSpacing:"0.08em", textTransform:"uppercase" }}>
                Score breakdown
              </div>
              <div style={{ display:"flex", gap:20, fontSize:12 }}>
                {[["Vector", Math.round(result.score*100-3)],
                  ["BM25",   Math.round(result.score*100-10)],
                  ["Final",  Math.round(result.score*100)]].map(([k,v]) => (
                  <div key={k}>
                    <span style={{ color:C.muted }}>{k}: </span>
                    <span style={{ color:k==="Final" ? C.accent : C.text, fontWeight:600 }}>{v}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
            <button
              onClick={() => navigator.clipboard && navigator.clipboard.writeText(result.content)}
              style={{ padding:"3px 10px", borderRadius:6, border:"1px solid rgba(255,255,255,0.09)",
                       background:"transparent", color:"#777", fontSize:11,
                       cursor:"pointer", fontFamily:"inherit" }}>
              Copy
            </button>
            <button style={{ padding:"3px 10px", borderRadius:6, border:"1px solid rgba(255,255,255,0.09)",
                             background:"transparent", color:"#777", fontSize:11,
                             cursor:"pointer", fontFamily:"inherit" }}>
              Open source
            </button>
            {showTrace && (
              <button
                onClick={() => setTraceOpen(!traceOpen)}
                style={{ padding:"3px 10px", borderRadius:6, fontSize:11, cursor:"pointer",
                         fontFamily:"inherit", background:"transparent",
                         border:`1px solid ${traceOpen ? C.accentBorder : "rgba(255,255,255,0.09)"}`,
                         color:traceOpen ? C.accent : "#777" }}>
                {traceOpen ? "Hide trace" : "Show trace"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [websites,    setWebsites]    = useState(INIT_WEBSITES);
  const [docs,        setDocs]        = useState(INIT_DOCS);
  const [convs,       setConvs]       = useState(INIT_CONVS);
  const [activeConv,  setActiveConv]  = useState("c1");
  const [modal,       setModal]       = useState(null);
  const [query,       setQuery]       = useState("");
  const [mode,        setMode]        = useState("hybrid");
  const [results,     setResults]     = useState(null);
  const [loading,     setLoading]     = useState(false);
  const [isTrace,     setIsTrace]     = useState(false);

  const currentConv = convs.find(c => c.id === activeConv);
  const totalReady  = websites.filter(w => w.status==="ready").length
                    + docs.filter(d => d.status==="ready").length;

  const newConv = () => {
    const id = "c" + mkId();
    setConvs(p => [{ id, title:"New conversation" }, ...p]);
    setActiveConv(id);
    setResults(null);
    setQuery("");
  };

  const addSource = (section, item) => {
    const id = mkId();
    const fresh = { ...item, id, status:"indexing", chunks:0 };
    const done  = { ...fresh, status:"ready",
                    chunks: item.type==="pdf" ? 180 : item.type==="md" ? 60 : 1100 };
    if (section === "websites") {
      setWebsites(p => [...p, fresh]);
      setTimeout(() => setWebsites(p => p.map(x => x.id===id ? done : x)), 2500);
    } else {
      setDocs(p => [...p, fresh]);
      setTimeout(() => setDocs(p => p.map(x => x.id===id ? done : x)), 1800);
    }
  };

  const doSearch = (trace = false) => {
    if (!query.trim()) return;
    setIsTrace(trace);
    setLoading(true);
    setResults(null);
    setTimeout(() => { setResults(MOCK_RESULTS); setLoading(false); }, 650);
  };

  const examples = [
    "How does useState work?",
    "App Router conventions",
    "How do I handle auth?",
    "What is a React effect?",
  ];

  return (
    <div style={{ display:"flex", height:"100vh", background:C.bg, color:C.text,
                  fontFamily:"system-ui,-apple-system,sans-serif", overflow:"hidden" }}>

      {/* SIDEBAR */}
      <div style={{ width:240, background:C.sidebar, borderRight:`1px solid ${C.border}`,
                    display:"flex", flexDirection:"column", height:"100%", flexShrink:0 }}>

        {/* Brand */}
        <div style={{ padding:"14px 14px 12px", borderBottom:`1px solid ${C.border}` }}>
          <div style={{ display:"flex", alignItems:"center", gap:9, marginBottom:10 }}>
            <div style={{ width:28, height:28, borderRadius:7, background:C.accent,
                          display:"flex", alignItems:"center", justifyContent:"center",
                          fontSize:14, color:"#000", fontWeight:900 }}>
              G
            </div>
            <div>
              <div style={{ fontSize:14, fontWeight:800, color:C.text, letterSpacing:"-0.02em" }}>GETHELP</div>
              <div style={{ fontSize:10, color:C.muted }}>local-first RAG</div>
            </div>
          </div>
          <div style={{ fontSize:11, color:C.mid, lineHeight:1.55,
                        background:"rgba(249,115,22,0.07)", border:`1px solid ${C.accentBorder}`,
                        borderRadius:6, padding:"5px 9px" }}>
            Crawls, chunks and indexes your docs locally — no internet at query time.
          </div>
        </div>

        {/* Conversations */}
        <div style={{ borderBottom:`1px solid ${C.border}`, padding:"10px 10px 8px" }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
            <span style={{ fontSize:10, fontWeight:700, color:C.mid,
                           letterSpacing:"0.08em", textTransform:"uppercase" }}>
              Conversations
            </span>
            <button onClick={newConv}
              style={{ display:"flex", alignItems:"center", gap:4, padding:"3px 8px",
                       borderRadius:6, border:`1px solid ${C.accentBorder}`,
                       background:C.accentDim, color:C.accent,
                       fontSize:11, fontWeight:600, cursor:"pointer", fontFamily:"inherit" }}>
              + New
            </button>
          </div>
          <div style={{ maxHeight:130, overflowY:"auto" }}>
            {convs.map(conv => (
              <ConvItem
                key={conv.id}
                conv={conv}
                active={activeConv === conv.id}
                onClick={() => { setActiveConv(conv.id); setResults(null); setQuery(""); }}
                onRename={t => setConvs(p => p.map(c => c.id===conv.id ? {...c, title:t} : c))}
                onDelete={() => {
                  setConvs(p => p.filter(c => c.id !== conv.id));
                  if (activeConv === conv.id) setActiveConv(convs.find(c => c.id!==conv.id)?.id || null);
                }}
              />
            ))}
          </div>
        </div>

        {/* Sources */}
        <div style={{ flex:1, overflowY:"auto", padding:"10px 10px 8px" }}>
          <SideSection
            title="Websites"
            items={websites}
            onAdd={() => setModal("websites")}
            onRemove={id => setWebsites(p => p.filter(w => w.id !== id))}
          />
          <div style={{ height:1, background:C.border, margin:"8px 0" }} />
          <SideSection
            title="Documentation"
            items={docs}
            onAdd={() => setModal("documentation")}
            onRemove={id => setDocs(p => p.filter(d => d.id !== id))}
          />
        </div>

        {/* Footer */}
        <div style={{ padding:"8px 14px 12px", borderTop:`1px solid ${C.border}`,
                      fontSize:11, color:C.muted, display:"flex", justifyContent:"space-between" }}>
          <span>{totalReady} sources ready</span>
          <span style={{ color:C.accent }}>plshelp</span>
        </div>
      </div>

      {/* MAIN */}
      <div style={{ flex:1, display:"flex", flexDirection:"column", height:"100%", overflow:"hidden" }}>

        {/* Top bar */}
        <div style={{ padding:"11px 22px 10px", borderBottom:`1px solid ${C.border}`,
                      display:"flex", alignItems:"center", gap:12, flexShrink:0 }}>
          <span style={{ flex:1, fontSize:14, fontWeight:700, color:C.text }}>
            {currentConv?.title || "Search"}
          </span>
          <span style={{ fontSize:12, color:C.muted }}>
            {websites.filter(w => w.status==="ready").length} websites
          </span>
          <span style={{ color:C.border }}>·</span>
          <span style={{ fontSize:12, color:C.muted }}>
            {docs.filter(d => d.status==="ready").length} docs
          </span>
        </div>

        {/* Results area */}
        <div style={{ flex:1, overflowY:"auto", padding:"24px 28px" }}>
          {!results && !loading && (
            <div style={{ display:"flex", flexDirection:"column", alignItems:"center",
                          justifyContent:"center", minHeight:"55%", textAlign:"center" }}>
              <div style={{ width:50, height:50, borderRadius:13, background:C.accentDim,
                            border:`1px solid ${C.accentBorder}`,
                            display:"flex", alignItems:"center", justifyContent:"center",
                            marginBottom:16, fontSize:22 }}>
                S
              </div>
              <div style={{ fontSize:19, fontWeight:800, color:C.text, marginBottom:6,
                            letterSpacing:"-0.02em" }}>
                Search your docs
              </div>
              <div style={{ fontSize:13, color:C.muted, maxWidth:360, lineHeight:1.65, marginBottom:24 }}>
                plshelp indexes your websites and documentation locally. Ask anything — results come from your own machine, not the internet.
              </div>
              <div style={{ display:"flex", flexWrap:"wrap", gap:8, justifyContent:"center", maxWidth:480 }}>
                {examples.map(ex => (
                  <button key={ex}
                    onClick={() => { setQuery(ex); setTimeout(() => doSearch(false), 60); }}
                    style={{ padding:"7px 16px", borderRadius:99,
                             border:`1px solid ${C.border}`,
                             background:C.card, color:C.mid,
                             fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>
                    {ex}
                  </button>
                ))}
              </div>
              {totalReady === 0 && (
                <div style={{ marginTop:24, padding:"10px 16px", borderRadius:8,
                              background:"rgba(249,115,22,0.07)",
                              border:`1px solid ${C.accentBorder}`,
                              fontSize:13, color:C.mid, maxWidth:320,
                              lineHeight:1.6, textAlign:"center" }}>
                  Add a website or PDF in the sidebar to get started.
                </div>
              )}
            </div>
          )}

          {loading && (
            <div style={{ display:"flex", alignItems:"center", justifyContent:"center",
                          height:200, fontSize:13, color:C.muted }}>
              {isTrace ? "Searching with trace..." : "Searching..."}
            </div>
          )}

          {results && !loading && (
            <div style={{ maxWidth:760, margin:"0 auto" }}>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16 }}>
                <div style={{ fontSize:13, color:C.muted }}>
                  <span style={{ color:C.text, fontWeight:700 }}>{results.length} results</span>
                  {" "}for &ldquo;{query}&rdquo;
                  {isTrace && (
                    <span style={{ marginLeft:8, color:C.accent, fontSize:12, fontWeight:600 }}>
                      with trace
                    </span>
                  )}
                </div>
                <button onClick={() => setResults(null)}
                  style={{ padding:"3px 10px", borderRadius:6,
                           border:"1px solid rgba(255,255,255,0.09)",
                           background:"transparent", color:"#777",
                           fontSize:11, cursor:"pointer", fontFamily:"inherit" }}>
                  Clear
                </button>
              </div>
              {results.map(r => (
                <ResultCard key={r.id} result={r} showTrace={isTrace} />
              ))}
            </div>
          )}
        </div>

        {/* Search bar */}
        <div style={{ padding:"12px 22px 16px", borderTop:`1px solid ${C.border}`,
                      flexShrink:0, background:C.sidebar }}>
          <div style={{ display:"flex", gap:6, marginBottom:10, alignItems:"center" }}>
            <span style={{ fontSize:12, color:C.muted, marginRight:2 }}>Mode:</span>
            {[["hybrid","Vector + keyword"],["vector","Meaning-based"],["keyword","Exact match"]].map(([m, hint]) => (
              <button key={m} onClick={() => setMode(m)}
                style={{ padding:"4px 12px", borderRadius:99,
                         border:`1px solid ${mode===m ? C.accentBorder : C.border}`,
                         background:mode===m ? C.accentDim : "transparent",
                         color:mode===m ? C.accent : C.muted,
                         fontSize:12, cursor:"pointer", fontFamily:"inherit",
                         fontWeight:mode===m ? 700 : 400 }}>
                {m}
              </button>
            ))}
            <span style={{ marginLeft:"auto", fontSize:11, color:C.muted }}>
              {mode==="hybrid" ? "Vector + keyword" : mode==="vector" ? "Meaning-based" : "Exact match"}
            </span>
          </div>

          <div style={{ display:"flex", gap:8, alignItems:"stretch" }}>
            <div style={{ flex:1, display:"flex", alignItems:"center", gap:10,
                          background:C.input, border:`1px solid ${C.border}`,
                          borderRadius:12, padding:"10px 14px" }}>
              <span style={{ color:C.muted, flexShrink:0, fontSize:14 }}>S</span>
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => e.key === "Enter" && doSearch(false)}
                placeholder="Ask anything about your linked docs..."
                style={{ flex:1, background:"none", border:"none", color:C.text,
                         fontSize:14, fontFamily:"inherit", outline:"none" }}
              />
              {query && (
                <button onClick={() => setQuery("")}
                  style={{ background:"none", border:"none", color:C.muted,
                           cursor:"pointer", fontSize:16, padding:2, lineHeight:1 }}>
                  x
                </button>
              )}
            </div>

            <button
              onClick={() => doSearch(false)}
              disabled={!query.trim()}
              style={{ padding:"10px 18px", borderRadius:10, border:"none",
                       background:query.trim() ? C.accent : "#1f1f1f",
                       color:query.trim() ? "#000" : C.muted,
                       fontSize:13, fontWeight:800, cursor:query.trim() ? "pointer" : "default",
                       fontFamily:"inherit", flexShrink:0 }}>
              Search
            </button>

            <button
              onClick={() => doSearch(true)}
              disabled={!query.trim()}
              title="Search with score breakdown per result"
              style={{ padding:"10px 16px", borderRadius:10,
                       border:`1px solid ${query.trim() ? C.accentBorder : C.border}`,
                       background:query.trim() ? C.accentDim : "transparent",
                       color:query.trim() ? C.accent : C.muted,
                       fontSize:13, fontWeight:700, cursor:query.trim() ? "pointer" : "default",
                       fontFamily:"inherit", flexShrink:0 }}>
              Trace
            </button>
          </div>

          <div style={{ marginTop:8, fontSize:11, color:C.muted, textAlign:"center" }}>
            Enter to search · Trace reveals score breakdown per result
          </div>
        </div>
      </div>

      {modal && (
        <AddModal
          section={modal}
          onAdd={item => { addSource(modal, item); setModal(null); }}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
