import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BadgeDollarSign, Building2, CalendarClock, CheckCircle2, ChevronDown,
  CircleAlert, ClipboardList, FileSearch, FileText, PanelLeft, Pencil, Plus,
  ReceiptText, RefreshCw, Search, Settings2, Trash2, WalletCards, X,
} from "lucide-react";
import AccountingOfficeManager from "./accounting-office-manager";
import { inferTaxBureau } from "../lib/tax-jurisdiction.mjs";

export type CaseItem = {
  id: number; caseNumber: string; receivedDate: string; year: number;
  clientName: string; companyName: string; taxId: string;
  entityType: "公司" | "行號"; precheckNo: string; caseType: string;
  caseContent: string; status: string; statusDetail: string;
  submittedDate: string; taxOfficeRequired: string; taxBureauCode: string;
  taxReceiptNo: string; taxReceivedDate: string; taxCaseType: string;
  taxOfficialStatus: string; taxCheckedAt: string; nextFollowUpDate: string;
  billingStatus: string; billingDate: string; totalDue: number;
  paidAmount: number; outstanding: number; paymentStatus: string;
  paymentDate: string; closedDate: string; notes: string;
  representative: string; address: string; capital: number; authority: string;
  officialReceiptNo: string; progressUrl: string; officialStatus: string;
  officialCheckedAt: string; officialAgencyCode: string; officialSubCaseNo: string;
  officialReceivedDate: string; officialOutgoingNo: string;
  officialOutgoingDate: string; officialSubject: string; regUnitCode: string;
  createdAt: string; updatedAt: string; lastEventDate: string; lastProgressDate: string;
};

type CaseEvent = { id: number; eventDate: string; eventType: string; status: string; detail: string };
type BillingItem = { id?: number; itemName: string; amount: number | string; notes: string };
type CaseDetail = { case: CaseItem; events: CaseEvent[]; billingItems: BillingItem[] };
type Reminder = { id: string; caseId: number; title: string; message: string; priority: number; companyName: string };
type OfficialCandidate = { index: number; receiptNo: string; companyName: string; receivedDate: string; officialStatus: string; authority: string; subject?: string };
type TaxCandidate = { index: number; receiptNo: string; businessName: string; receivedDate: string; caseType: string; officialStatus: string };
type ApiError = Error & { code?: string };

const statuses = [
  "準備中", "待補資料", "資料確認", "待送件", "送件中", "已送件",
  "審查中", "補件", "打字中", "校對中", "核准發文中", "可自領",
  "郵寄", "電子送達", "核准", "已領件", "國稅局辦理", "結案", "取消",
];
const caseTypes = ["新設立", "變更登記", "解散／停業", "復業", "其他"];
const taxBureaus = [
  { value: "A05", label: "臺北國稅局" }, { value: "H01", label: "北區國稅局" },
  { value: "B01", label: "中區國稅局" }, { value: "D01", label: "南區國稅局" },
  { value: "E01", label: "高雄國稅局" },
];

const today = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date());
const currency = (value: number | string) => new Intl.NumberFormat("zh-TW", {
  style: "currency", currency: "TWD", maximumFractionDigits: 0,
}).format(Number(value) || 0);

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: options.body ? { "content-type": "application/json", ...(options.headers ?? {}) } : options.headers,
  });
  const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; message?: string; code?: string } & T;
  if (!response.ok || payload.ok === false) {
    const error = new Error(payload.message || "操作失敗") as ApiError;
    error.code = payload.code;
    throw error;
  }
  return payload;
}

function statusTone(status: string) {
  if (["準備中", "待補資料", "資料確認", "待送件"].includes(status)) return "prep";
  if (status === "補件") return "attention";
  if (["可自領", "郵寄", "電子送達", "核准"].includes(status)) return "ready";
  if (["已領件", "國稅局辦理"].includes(status)) return "tax";
  if (["結案", "取消"].includes(status)) return "done";
  return "review";
}
function taxSummary(item: CaseItem) {
  if (item.taxOfficeRequired === "不需要") return "免送國稅局";
  if (item.taxOfficeRequired === "已完成") return "國稅局完成";
  if (item.taxOfficialStatus) return item.taxOfficialStatus;
  if (item.taxOfficeRequired === "辦理中" || item.status === "國稅局辦理") return "國稅局辦理中";
  if (item.taxOfficeRequired === "需要") return "待辦國稅局";
  return "尚未確認";
}

function Modal({ title, eyebrow, onClose, wide = false, children }: {
  title: string; eyebrow?: string; onClose: () => void; wide?: boolean; children: React.ReactNode;
}) {
  return <div className="erp-modal-backdrop" role="presentation" onMouseDown={onClose}>
    <section className={`erp-modal${wide ? " wide" : ""}`} role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}>
      <header><div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h2>{title}</h2></div><button className="erp-icon-button" aria-label="關閉" onClick={onClose}><X size={18} /></button></header>
      {children}
    </section>
  </div>;
}

const emptyCaseForm = () => ({
  receivedDate: today(), clientName: "", companyName: "", taxId: "",
  entityType: "公司" as "公司" | "行號", precheckNo: "", caseType: "新設立",
  caseContent: "", status: "準備中", statusDetail: "等待客戶提供資料",
  notes: "", representative: "", address: "", capital: "", authority: "",
});

export default function CasesDashboard({ onOpenWizard }: { onOpenWizard: (item: CaseItem) => void }) {
  const currentYear = Number(today().slice(0, 4));
  const [year, setYear] = useState(currentYear);
  const [cases, setCases] = useState<CaseItem[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [entityFilter, setEntityFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [detail, setDetail] = useState<CaseDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [caseEditor, setCaseEditor] = useState<{ id?: number; form: ReturnType<typeof emptyCaseForm> } | null>(null);
  const [statusEditor, setStatusEditor] = useState<{
    id: number; eventDate: string; status: string; detail: string; submittedDate: string;
    officialReceiptNo: string; regUnitCode: string; taxOfficeRequired: string;
    taxBureauCode: string; nextFollowUpDate: string;
  } | null>(null);
  const [billingEditor, setBillingEditor] = useState<{
    id: number; billingStatus: string; billingDate: string; paidAmount: string;
    paymentDate: string; items: BillingItem[];
  } | null>(null);
  const [officialSelection, setOfficialSelection] = useState<{
    caseId: number; querySessionId: string; candidates: OfficialCandidate[];
  } | null>(null);
  const [taxDialog, setTaxDialog] = useState<{
    caseId: number; bureauCode: string; sessionId: string; captchaUrl: string;
    captchaText: string; results: TaxCandidate[]; message: string; busy: boolean;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [navOpen, setNavOpen] = useState(true);
  const [officeManagerOpen, setOfficeManagerOpen] = useState(false);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError("");
    try {
      const [caseData, reminderData] = await Promise.all([
        api<{ cases: CaseItem[] }>(`/api/cases?year=${year}`),
        api<{ reminders: Reminder[] }>("/api/reminders"),
      ]);
      setCases(caseData.cases);
      setReminders(reminderData.reminders);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "案件資料讀取失敗");
    } finally { setLoading(false); }
  }, [year]);
  useEffect(() => { void load(); }, [load]);

  const refreshDetail = useCallback(async (id: number) => {
    setDetailLoading(true);
    try { setDetail(await api<CaseDetail>(`/api/cases/${id}`)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "案件明細讀取失敗"); }
    finally { setDetailLoading(false); }
  }, []);

  const filteredCases = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return cases.filter((item) => {
      const haystack = `${item.companyName} ${item.taxId} ${item.caseContent} ${item.clientName}`.toLowerCase();
      return (!needle || haystack.includes(needle)) && (!entityFilter || item.entityType === entityFilter) && (!statusFilter || item.status === statusFilter);
    });
  }, [cases, entityFilter, search, statusFilter]);
  const metrics = useMemo(() => ({
    active: cases.filter((item) => !["結案", "取消"].includes(item.status)).length,
    preparing: cases.filter((item) => ["準備中", "待補資料", "資料確認", "待送件"].includes(item.status)).length,
    government: cases.filter((item) => ["已送件", "送件中", "審查中", "補件", "打字中", "校對中", "核准發文中", "可自領"].includes(item.status)).length,
    reminders: reminders.length,
  }), [cases, reminders]);

  const openCaseEditor = (item?: CaseItem) => setCaseEditor({
    id: item?.id,
    form: item ? {
      receivedDate: item.receivedDate, clientName: item.clientName, companyName: item.companyName,
      taxId: item.taxId, entityType: item.entityType, precheckNo: item.precheckNo,
      caseType: item.caseType, caseContent: item.caseContent, status: item.status,
      statusDetail: item.statusDetail, notes: item.notes, representative: item.representative,
      address: item.address, capital: item.capital ? String(item.capital) : "", authority: item.authority,
    } : emptyCaseForm(),
  });

  const saveCase = async (event: React.FormEvent) => {
    event.preventDefault(); if (!caseEditor) return; setBusy(true);
    try {
      const result = await api<{ case: CaseItem }>(caseEditor.id ? `/api/cases/${caseEditor.id}` : "/api/cases", {
        method: caseEditor.id ? "PUT" : "POST", body: JSON.stringify(caseEditor.form),
      });
      setCaseEditor(null); setNotice(caseEditor.id ? "案件資料已更新" : "案件已建立");
      await load(true); await refreshDetail(result.case.id);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "案件儲存失敗"); }
    finally { setBusy(false); }
  };

  const openStatusEditor = (item: CaseItem) => setStatusEditor({
    id: item.id, eventDate: today(), status: item.status, detail: item.statusDetail || "",
    submittedDate: item.submittedDate || "", officialReceiptNo: item.officialReceiptNo || "",
    regUnitCode: item.regUnitCode || "17", taxOfficeRequired: item.taxOfficeRequired || "未確認",
    taxBureauCode: item.taxBureauCode || inferTaxBureau(item.address)?.bureauCode || "", nextFollowUpDate: item.nextFollowUpDate || "",
  });
  const saveStatus = async (event: React.FormEvent) => {
    event.preventDefault(); if (!statusEditor) return; setBusy(true);
    try {
      await api(`/api/cases/${statusEditor.id}/events`, { method: "POST", body: JSON.stringify(statusEditor) });
      const id = statusEditor.id; setStatusEditor(null); setNotice("進度已更新並寫入歷程");
      await load(true); await refreshDetail(id);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "進度更新失敗"); }
    finally { setBusy(false); }
  };

  const openBillingEditor = (current: CaseDetail) => setBillingEditor({
    id: current.case.id, billingStatus: current.case.billingStatus || "未請款",
    billingDate: current.case.billingDate || "", paidAmount: current.case.paidAmount ? String(current.case.paidAmount) : "",
    paymentDate: current.case.paymentDate || "", items: current.billingItems.length
      ? current.billingItems.map((item) => ({ ...item }))
      : [{ itemName: current.case.caseContent || "代辦服務費", amount: "", notes: "" }],
  });
  const saveBilling = async (event: React.FormEvent) => {
    event.preventDefault(); if (!billingEditor) return; setBusy(true);
    try {
      await api(`/api/cases/${billingEditor.id}/billing`, { method: "PUT", body: JSON.stringify(billingEditor) });
      const id = billingEditor.id; setBillingEditor(null); setNotice("請款與收款資料已儲存");
      await load(true); await refreshDetail(id);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "收費資料儲存失敗"); }
    finally { setBusy(false); }
  };

  const checkOfficial = async (item: CaseItem) => {
    setBusy(true); setError("");
    try {
      const result = await api<{ selectionRequired: boolean; querySessionId?: string; candidates?: OfficialCandidate[] }>(`/api/cases/${item.id}/check-progress`, { method: "POST", body: "{}" });
      if (result.selectionRequired && result.querySessionId && result.candidates) setOfficialSelection({ caseId: item.id, querySessionId: result.querySessionId, candidates: result.candidates });
      else { setNotice("已帶入最新官方進度"); await load(true); await refreshDetail(item.id); }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "官方進度查詢失敗"); }
    finally { setBusy(false); }
  };
  const applyOfficial = async (index: number) => {
    if (!officialSelection) return; setBusy(true);
    try {
      await api(`/api/cases/${officialSelection.caseId}/check-progress`, { method: "POST", body: JSON.stringify({ querySessionId: officialSelection.querySessionId, candidateIndex: index }) });
      const id = officialSelection.caseId; setOfficialSelection(null); setNotice("已連結選定的官方案件");
      await load(true); await refreshDetail(id);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "官方案件連結失敗"); }
    finally { setBusy(false); }
  };

  const loadTaxCaptcha = async (target = taxDialog) => {
    if (!target?.bureauCode) return;
    setTaxDialog((current) => current ? { ...current, busy: true, message: "正在取得並辨識官方驗證碼…", results: [] } : null);
    try {
      const result = await api<{ sessionId: string; captchaUrl?: string; automatic: boolean; results: TaxCandidate[]; message: string }>(`/api/cases/${target.caseId}/tax-query-session`, { method: "POST", body: JSON.stringify({ bureauCode: target.bureauCode }) });
      setTaxDialog((current) => current ? {
        ...current,
        sessionId: result.sessionId,
        captchaUrl: result.captchaUrl ? `${result.captchaUrl}?v=${Date.now()}` : "",
        captchaText: "",
        results: result.results || [],
        message: result.message,
        busy: false,
      } : null);
    } catch (reason) { setTaxDialog((current) => current ? { ...current, busy: false, message: reason instanceof Error ? reason.message : "驗證碼載入失敗" } : null); }
  };
  const openTax = (item: CaseItem) => {
    const bureauCode = item.taxBureauCode || inferTaxBureau(item.address)?.bureauCode || "";
    const next = {
      caseId: item.id, bureauCode, sessionId: "", captchaUrl: "",
      captchaText: "", results: [] as TaxCandidate[],
      message: bureauCode ? "已依公司地址判定主管國稅局，準備自動查詢…" : "公司地址無法判定主管國稅局，請先手動選擇。",
      busy: Boolean(bureauCode),
    };
    setTaxDialog(next);
    if (bureauCode) void loadTaxCaptcha(next);
  };
  const submitTax = async (event: React.FormEvent) => {
    event.preventDefault(); if (!taxDialog?.sessionId) return;
    setTaxDialog({ ...taxDialog, busy: true, message: "正在查詢國稅局案件…" });
    try {
      const result = await api<{ results: TaxCandidate[]; message: string }>(`/api/cases/${taxDialog.caseId}/check-tax-progress`, { method: "POST", body: JSON.stringify({ sessionId: taxDialog.sessionId, captchaText: taxDialog.captchaText }) });
      setTaxDialog((current) => current ? { ...current, busy: false, results: result.results, message: result.message } : null);
    } catch (reason) { const failure = reason as ApiError; setTaxDialog((current) => current ? { ...current, busy: false, sessionId: "", captchaUrl: "", message: failure.message || "國稅局查詢失敗，請重新載入驗證碼。" } : null); }
  };
  const applyTax = async (index: number) => {
    if (!taxDialog?.sessionId) return; setTaxDialog({ ...taxDialog, busy: true, message: "正在帶入國稅局進度…" });
    try {
      const result = await api<{ duplicatePrevented?: boolean }>(`/api/cases/${taxDialog.caseId}/apply-tax-progress`, { method: "POST", body: JSON.stringify({ sessionId: taxDialog.sessionId, candidateIndex: index }) });
      const id = taxDialog.caseId; setTaxDialog(null);
      setNotice(result.duplicatePrevented ? "已確認最新國稅局進度，未重複新增案件歷程" : "已帶入國稅局案件進度");
      await load(true); await refreshDetail(id);
    } catch (reason) { setTaxDialog((current) => current ? { ...current, busy: false, message: reason instanceof Error ? reason.message : "國稅局案件帶入失敗" } : null); }
  };

  const removeEvent = async (event: CaseEvent) => {
    if (!detail || !window.confirm(`確定刪除 ${event.eventDate} 的「${event.eventType}」歷程？\n此操作無法復原。`)) return;
    setBusy(true); setError("");
    try {
      await api(`/api/cases/${detail.case.id}/events/${event.id}`, { method: "DELETE" });
      setNotice("案件歷程已刪除");
      await load(true); await refreshDetail(detail.case.id);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "案件歷程刪除失敗"); }
    finally { setBusy(false); }
  };

  const removeCase = async (item: CaseItem) => {
    if (!window.confirm(`確定刪除「${item.companyName}」？\n案件歷程、資料準備、請款與購票證設定會一併刪除，且無法復原。`)) return;
    setBusy(true); setError("");
    try {
      await api(`/api/cases/${item.id}`, { method: "DELETE" });
      if (detail?.case.id === item.id) setDetail(null);
      setNotice(`已刪除案件：${item.companyName}`);
      await load(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "案件刪除失敗"); }
    finally { setBusy(false); }
  };

  return <div className={`erp-shell${navOpen ? " nav-open" : ""}`}>
    <aside className="erp-sidebar" aria-label="主要功能">
      <div className="erp-brand-row"><div className="erp-brand-mark">工</div><div className="erp-sidebar-copy"><strong>案件管理</strong><small>CASE DESK</small></div><button className="erp-sidebar-collapse" aria-label="收合左側選單" title="收合選單" onClick={() => setNavOpen(false)}><PanelLeft size={18} /></button></div>
      <button className="erp-sidebar-expand" aria-label="展開左側選單" title="展開選單" onClick={() => setNavOpen(true)}><PanelLeft size={19} /></button>
      <nav>
        <button className="erp-nav-item active" title="案件管理" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}><ClipboardList size={19} /><span className="erp-nav-label">案件管理</span></button>
        <button className="erp-nav-item" title="請款與收款" onClick={() => document.getElementById("erp-billing")?.scrollIntoView({ behavior: "smooth" })}><WalletCards size={19} /><span className="erp-nav-label">請款與收款</span></button>
        <button className="erp-nav-item" title="事務所設定" onClick={() => setOfficeManagerOpen(true)}><Settings2 size={19} /><span className="erp-nav-label">事務所設定</span></button>
        <a className="erp-nav-item" href="/api/backup" title="下載資料備份"><FileText size={19} /><span className="erp-nav-label">下載資料備份</span></a>
      </nav>
      <div className="erp-sidebar-spacer" />
      <div className="erp-connection"><i /><span className="erp-nav-label">本機資料已連線<small>PORT 5566</small></span></div>
    </aside>
    <div className="erp-workspace"><main className="erp-main">
    <header className="erp-header"><div><p className="eyebrow">CASE MANAGEMENT · LOCAL ERP</p><h1>工商案件管理台帳</h1><p>先掌握每一件案件的進度，再從案件明細進入 OCR 與送件文件準備。</p></div><div className="erp-header-actions"><select aria-label="案件年度" value={year} onChange={(event) => setYear(Number(event.target.value))}>{Array.from({ length: 7 }, (_, index) => currentYear - index).map((value) => <option key={value}>{value}</option>)}</select><a className="secondary" href="/api/backup"><FileText size={16} />下載備份</a><button className="primary" onClick={() => openCaseEditor()}><Plus size={16} />新增案件</button></div></header>

    {(error || notice) && <div className={error ? "erp-banner error" : "erp-banner success"} role="status">{error ? <CircleAlert size={17} /> : <CheckCircle2 size={17} />}<span>{error || notice}</span><button aria-label="關閉訊息" onClick={() => { setError(""); setNotice(""); }}><X size={15} /></button></div>}

    <section className="erp-metrics" aria-label="案件概況"><article><ClipboardList /><span>進行中</span><strong>{metrics.active}</strong><small>尚未結案</small></article><article><CalendarClock /><span>資料準備</span><strong>{metrics.preparing}</strong><small>等待資料或待送件</small></article><article><Building2 /><span>市府辦理</span><strong>{metrics.government}</strong><small>送件至可領件</small></article><article><CircleAlert /><span>需要留意</span><strong>{metrics.reminders}</strong><small>追蹤、領件或請款</small></article></section>

    <section className="erp-panel erp-reminders"><header><div><p className="eyebrow">ACTION REMINDERS</p><h2>需要處理的事情</h2></div></header>{reminders.length ? reminders.slice(0, 8).map((item) => <button key={item.id} className={`erp-reminder priority-${item.priority}`} onClick={() => void refreshDetail(item.caseId)}><i /><span><strong>{item.companyName}</strong><small>{item.title}</small></span><p>{item.message}</p><ChevronDown size={16} /></button>) : <p className="erp-empty-inline"><CheckCircle2 size={18} />目前沒有需要立即處理的提醒。</p>}</section>

    <section className="erp-panel"><header className="erp-panel-heading"><div><p className="eyebrow">CASE REGISTER</p><h2>{year} 年案件</h2><p>完整保存市政府、國稅局、請款與歷程。</p></div><button className="secondary small" disabled={loading} onClick={() => void load()}><RefreshCw size={15} />重新整理</button></header><div className="erp-filters"><label><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜尋公司、統編、客戶或案件內容" /></label><select value={entityFilter} onChange={(event) => setEntityFilter(event.target.value)}><option value="">公司＋行號</option><option>公司</option><option>行號</option></select><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">全部進度</option>{statuses.map((status) => <option key={status}>{status}</option>)}</select></div>
      {loading ? <p className="erp-loading">案件資料讀取中…</p> : !filteredCases.length ? <div className="erp-empty"><ClipboardList size={28} /><h3>目前沒有符合條件的案件</h3><p>新增第一筆案件，或調整上方篩選條件。</p></div> : <div className="erp-case-list">{filteredCases.map((item) => <article key={item.id}><button className="erp-case-main" onClick={() => void refreshDetail(item.id)}><span className="erp-entity" data-type={item.entityType}>{item.entityType}</span><span className="erp-case-name"><strong>{item.companyName}</strong><small>{item.caseNumber}・{item.taxId ? `統編 ${item.taxId}` : "尚無統編"}</small></span><span><strong>{item.caseType}</strong><small>{item.caseContent}</small></span><span><em className="erp-status" data-tone={statusTone(item.status)}>{item.status}</em><small>{item.statusDetail || "尚無說明"}</small></span><span><em className="erp-tax">{taxSummary(item)}</em><small>{item.taxReceiptNo || "國稅局文號未登記"}</small></span><span><strong>{item.paymentStatus}</strong><small>{item.totalDue ? `${currency(item.totalDue)}・尚欠 ${currency(item.outstanding)}` : "尚未建立收費"}</small></span><ChevronDown size={17} /></button><button className="erp-row-delete" disabled={busy} aria-label={`刪除 ${item.companyName}`} title="刪除案件" onClick={() => void removeCase(item)}><Trash2 size={16} /></button></article>)}</div>}
    </section>

    <section className="erp-panel" id="erp-billing"><header className="erp-panel-heading"><div><p className="eyebrow">RECEIVABLES</p><h2>請款與收款</h2><p>從案件明細建立收費項目，再由此快速掌握待請款與尚欠款案件。</p></div><WalletCards size={21} /></header>{cases.length ? <div className="erp-billing-list">{cases.map((item) => <button key={item.id} onClick={() => void refreshDetail(item.id)}><span><strong>{item.companyName}</strong><small>{item.caseNumber}・{item.paymentStatus}</small></span><span><strong>{item.totalDue ? currency(item.totalDue) : "尚未建立"}</strong><small>{item.outstanding ? `尚欠 ${currency(item.outstanding)}` : "目前無欠款"}</small></span><ChevronDown size={16} /></button>)}</div> : <p className="erp-empty-inline"><WalletCards size={18} />建立案件後，這裡會顯示請款與收款摘要。</p>}</section>

    {detail && <Modal title={detail.case.companyName} eyebrow={`${detail.case.caseNumber} · ${detail.case.entityType}`} wide onClose={() => setDetail(null)}>{detailLoading && <p className="erp-loading">更新案件明細中…</p>}<div className="erp-detail-summary"><article><span>目前進度</span><strong>{detail.case.status}</strong><small>{detail.case.statusDetail || "—"}</small></article><article><span>市府資料</span><strong>{detail.case.officialStatus || detail.case.officialReceiptNo || "尚未連結"}</strong><small>{detail.case.officialOutgoingNo || detail.case.authority || "—"}</small></article><article><span>國稅局</span><strong>{taxSummary(detail.case)}</strong><small>{detail.case.taxReceiptNo || "—"}</small></article><article><span>收款</span><strong>{detail.case.paymentStatus}</strong><small>{detail.case.totalDue ? `${currency(detail.case.paidAmount)}／${currency(detail.case.totalDue)}` : "尚未建立收費"}</small></article></div><div className="erp-detail-grid"><dl><div><dt>收件日期</dt><dd>{detail.case.receivedDate}</dd></div><div><dt>客戶／聯絡人</dt><dd>{detail.case.clientName || "—"}</dd></div><div><dt>統一編號</dt><dd>{detail.case.taxId || "新設立・尚無統編"}</dd></div><div><dt>辦理內容</dt><dd>{detail.case.caseContent}</dd></div><div><dt>負責人</dt><dd>{detail.case.representative || "—"}</dd></div><div><dt>公司地址</dt><dd>{detail.case.address || "—"}</dd></div><div><dt>下次追蹤</dt><dd>{detail.case.nextFollowUpDate || "—"}</dd></div><div><dt>備註</dt><dd>{detail.case.notes || "—"}</dd></div></dl><section className="erp-history"><h3>案件歷程</h3>{detail.events.map((event) => <article key={event.id}><time>{event.eventDate}</time><span>{event.eventType}</span><p><strong>{event.status}</strong>{event.detail || "—"}</p><button className="erp-history-delete" disabled={busy} aria-label={`刪除 ${event.eventDate} ${event.eventType} 歷程`} title="刪除這筆歷程" onClick={() => void removeEvent(event)}><Trash2 size={14} /></button></article>)}</section></div><footer className="erp-detail-actions"><button className="danger secondary" disabled={busy} onClick={() => void removeCase(detail.case)}><Trash2 size={15} />刪除案件</button><button className="secondary" onClick={() => openCaseEditor(detail.case)}><Pencil size={15} />編輯基本資料</button><button className="secondary" onClick={() => openStatusEditor(detail.case)}><ClipboardList size={15} />更新完整進度</button><button className="secondary" disabled={busy || !detail.case.taxId} onClick={() => void checkOfficial(detail.case)}><FileSearch size={15} />查市府進度</button><button className="secondary" disabled={!detail.case.taxId} onClick={() => openTax(detail.case)}><Building2 size={15} />查國稅局</button><button className="secondary" onClick={() => openBillingEditor(detail)}><ReceiptText size={15} />請款與收款</button><button className="primary" onClick={() => onOpenWizard(detail.case)}><FileText size={15} />資料準備與 OCR</button></footer></Modal>}

    {caseEditor && <Modal title={caseEditor.id ? "編輯案件資料" : "新增案件"} eyebrow="CASE PROFILE" wide onClose={() => setCaseEditor(null)}><form onSubmit={saveCase}><div className="erp-form-grid"><label>收件日期<input type="date" required value={caseEditor.form.receivedDate} onChange={(event) => setCaseEditor({ ...caseEditor, form: { ...caseEditor.form, receivedDate: event.target.value } })} /></label><label>公司或行號<select value={caseEditor.form.entityType} onChange={(event) => setCaseEditor({ ...caseEditor, form: { ...caseEditor.form, entityType: event.target.value as "公司" | "行號" } })}><option>公司</option><option>行號</option></select></label><label className="span-2">公司／行號名稱<input required value={caseEditor.form.companyName} onChange={(event) => setCaseEditor({ ...caseEditor, form: { ...caseEditor.form, companyName: event.target.value } })} /></label><label>統一編號<input inputMode="numeric" maxLength={8} value={caseEditor.form.taxId} onChange={(event) => setCaseEditor({ ...caseEditor, form: { ...caseEditor.form, taxId: event.target.value.replace(/\D/g, "") } })} placeholder="新設立可留白" /></label><label>客戶／聯絡人<input value={caseEditor.form.clientName} onChange={(event) => setCaseEditor({ ...caseEditor, form: { ...caseEditor.form, clientName: event.target.value } })} /></label><label>案件種類<select required value={caseEditor.form.caseType} onChange={(event) => setCaseEditor({ ...caseEditor, form: { ...caseEditor.form, caseType: event.target.value } })}>{caseTypes.map((type) => <option key={type}>{type}</option>)}</select></label><label>名稱預查編號<input value={caseEditor.form.precheckNo} onChange={(event) => setCaseEditor({ ...caseEditor, form: { ...caseEditor.form, precheckNo: event.target.value } })} /></label><label className="span-2">辦理內容<input required value={caseEditor.form.caseContent} onChange={(event) => setCaseEditor({ ...caseEditor, form: { ...caseEditor.form, caseContent: event.target.value } })} placeholder="例如：公司新設立、營業項目變更" /></label>{!caseEditor.id && <><label>初始進度<select value={caseEditor.form.status} onChange={(event) => setCaseEditor({ ...caseEditor, form: { ...caseEditor.form, status: event.target.value } })}>{statuses.map((status) => <option key={status}>{status}</option>)}</select></label><label>進度說明<input value={caseEditor.form.statusDetail} onChange={(event) => setCaseEditor({ ...caseEditor, form: { ...caseEditor.form, statusDetail: event.target.value } })} /></label></>}<label>負責人<input value={caseEditor.form.representative} onChange={(event) => setCaseEditor({ ...caseEditor, form: { ...caseEditor.form, representative: event.target.value } })} /></label><label>資本額<input inputMode="numeric" value={caseEditor.form.capital} onChange={(event) => setCaseEditor({ ...caseEditor, form: { ...caseEditor.form, capital: event.target.value } })} /></label><label className="span-2">公司地址<input value={caseEditor.form.address} onChange={(event) => setCaseEditor({ ...caseEditor, form: { ...caseEditor.form, address: event.target.value } })} /></label><label className="span-2">主管機關<input value={caseEditor.form.authority} onChange={(event) => setCaseEditor({ ...caseEditor, form: { ...caseEditor.form, authority: event.target.value } })} /></label><label className="span-2">備註<textarea value={caseEditor.form.notes} onChange={(event) => setCaseEditor({ ...caseEditor, form: { ...caseEditor.form, notes: event.target.value } })} /></label></div><footer className="erp-form-actions"><button type="button" className="secondary" onClick={() => setCaseEditor(null)}>取消</button><button className="primary" disabled={busy}>{busy ? "儲存中…" : "儲存案件"}</button></footer></form></Modal>}

    {statusEditor && <Modal title="更新完整進度" eyebrow="CASE TIMELINE" wide onClose={() => setStatusEditor(null)}><form onSubmit={saveStatus}><div className="erp-form-grid"><label>更新日期<input type="date" required value={statusEditor.eventDate} onChange={(event) => setStatusEditor({ ...statusEditor, eventDate: event.target.value })} /></label><label>目前進度<select value={statusEditor.status} onChange={(event) => setStatusEditor({ ...statusEditor, status: event.target.value })}>{statuses.map((status) => <option key={status}>{status}</option>)}</select></label><label className="span-2">進度說明<textarea required value={statusEditor.detail} onChange={(event) => setStatusEditor({ ...statusEditor, detail: event.target.value })} /></label><label>市府送件日期<input type="date" value={statusEditor.submittedDate} onChange={(event) => setStatusEditor({ ...statusEditor, submittedDate: event.target.value })} /></label><label>市府收文號<input value={statusEditor.officialReceiptNo} onChange={(event) => setStatusEditor({ ...statusEditor, officialReceiptNo: event.target.value })} /></label><label>國稅局狀態<select value={statusEditor.taxOfficeRequired} onChange={(event) => setStatusEditor({ ...statusEditor, taxOfficeRequired: event.target.value })}><option>未確認</option><option>需要</option><option>辦理中</option><option>不需要</option><option>已完成</option></select></label><label>主管國稅局<small className="erp-field-hint">依公司地址自動帶入，可手動修正</small><select value={statusEditor.taxBureauCode} onChange={(event) => setStatusEditor({ ...statusEditor, taxBureauCode: event.target.value })}><option value="">尚未選擇</option>{taxBureaus.map((bureau) => <option value={bureau.value} key={bureau.value}>{bureau.label}</option>)}</select></label><label>下次追蹤日期<input type="date" value={statusEditor.nextFollowUpDate} onChange={(event) => setStatusEditor({ ...statusEditor, nextFollowUpDate: event.target.value })} /></label><label>登記單位代碼<input value={statusEditor.regUnitCode} onChange={(event) => setStatusEditor({ ...statusEditor, regUnitCode: event.target.value })} /></label></div><footer className="erp-form-actions"><button type="button" className="secondary" onClick={() => setStatusEditor(null)}>取消</button><button className="primary" disabled={busy}>{busy ? "儲存中…" : "儲存進度"}</button></footer></form></Modal>}

    {billingEditor && <Modal title="請款與收款" eyebrow="BILLING" wide onClose={() => setBillingEditor(null)}><form onSubmit={saveBilling}><div className="erp-form-grid"><label>請款狀態<select value={billingEditor.billingStatus} onChange={(event) => setBillingEditor({ ...billingEditor, billingStatus: event.target.value })}><option>未請款</option><option>已請款</option><option>已收款</option></select></label><label>請款日期<input type="date" value={billingEditor.billingDate} onChange={(event) => setBillingEditor({ ...billingEditor, billingDate: event.target.value })} /></label><label>已收金額<input inputMode="numeric" value={billingEditor.paidAmount} onChange={(event) => setBillingEditor({ ...billingEditor, paidAmount: event.target.value })} /></label><label>收款日期<input type="date" value={billingEditor.paymentDate} onChange={(event) => setBillingEditor({ ...billingEditor, paymentDate: event.target.value })} /></label></div><section className="erp-billing-items"><header><h3>收費明細</h3><button type="button" className="secondary small" onClick={() => setBillingEditor({ ...billingEditor, items: [...billingEditor.items, { itemName: "", amount: "", notes: "" }] })}><Plus size={14} />增加項目</button></header>{billingEditor.items.map((item, index) => <div key={index}><input aria-label={`第 ${index + 1} 項名稱`} placeholder="辦理項目" value={item.itemName} onChange={(event) => setBillingEditor({ ...billingEditor, items: billingEditor.items.map((row, position) => position === index ? { ...row, itemName: event.target.value } : row) })} /><input aria-label={`第 ${index + 1} 項金額`} inputMode="numeric" placeholder="金額" value={item.amount} onChange={(event) => setBillingEditor({ ...billingEditor, items: billingEditor.items.map((row, position) => position === index ? { ...row, amount: event.target.value } : row) })} /><input aria-label={`第 ${index + 1} 項備註`} placeholder="備註" value={item.notes} onChange={(event) => setBillingEditor({ ...billingEditor, items: billingEditor.items.map((row, position) => position === index ? { ...row, notes: event.target.value } : row) })} /><button type="button" aria-label="刪除此項" onClick={() => setBillingEditor({ ...billingEditor, items: billingEditor.items.filter((_, position) => position !== index) })}><X size={15} /></button></div>)}</section><p className="erp-billing-total"><BadgeDollarSign size={18} />應收總額 <strong>{currency(billingEditor.items.reduce((sum, item) => sum + (Number(String(item.amount).replace(/,/g, "")) || 0), 0))}</strong></p><footer className="erp-form-actions"><button type="button" className="secondary" onClick={() => setBillingEditor(null)}>取消</button><button className="primary" disabled={busy}>{busy ? "儲存中…" : "儲存收費"}</button></footer></form></Modal>}

    {officialSelection && <Modal title="選擇官方案件" eyebrow="OFFICIAL RESULTS" wide onClose={() => setOfficialSelection(null)}><div className="erp-result-list">{officialSelection.candidates.map((candidate) => <button key={candidate.index} disabled={busy} onClick={() => void applyOfficial(candidate.index)}><strong>{candidate.companyName || "名稱未提供"}</strong><span>{candidate.receiptNo || "無收文號"}・{candidate.receivedDate || "日期不明"}</span><small>{candidate.officialStatus || candidate.subject || "進度未提供"}・{candidate.authority || "受理機關未提供"}</small></button>)}</div></Modal>}

    {taxDialog && <Modal title="國稅局進度查詢" eyebrow="TAX OFFICE" wide onClose={() => setTaxDialog(null)}><form onSubmit={submitTax}><div className="erp-tax-query"><label>主管國稅局<small className="erp-field-hint">依公司地址自動帶入，只查五區層級</small><select value={taxDialog.bureauCode} onChange={(event) => setTaxDialog({ ...taxDialog, bureauCode: event.target.value, sessionId: "", captchaUrl: "", results: [], message: "主管國稅局已調整，按下方按鈕重新查詢。" })}><option value="">請選擇</option>{taxBureaus.map((bureau) => <option value={bureau.value} key={bureau.value}>{bureau.label}</option>)}</select></label><button type="button" className="secondary" disabled={!taxDialog.bureauCode || taxDialog.busy} onClick={() => void loadTaxCaptcha()}>{taxDialog.busy ? "自動查詢中…" : "重新自動查詢"}</button>{taxDialog.captchaUrl && <><img src={taxDialog.captchaUrl} alt="國稅局圖形驗證碼" onClick={() => void loadTaxCaptcha()} /><label>自動辨識失敗，請輸入驗證碼<input autoComplete="off" maxLength={6} value={taxDialog.captchaText} onChange={(event) => setTaxDialog({ ...taxDialog, captchaText: event.target.value.toUpperCase() })} /></label><button className="primary" disabled={!taxDialog.sessionId || !taxDialog.captchaText || taxDialog.busy}>人工驗證後查詢</button></>}</div></form><p className="erp-query-message">{taxDialog.message}</p>{!!taxDialog.results.length && <div className="erp-result-list">{taxDialog.results.map((candidate) => <button key={candidate.index} disabled={taxDialog.busy} onClick={() => void applyTax(candidate.index)}><strong>{candidate.businessName}</strong><span>{candidate.receiptNo}・{candidate.receivedDate}</span><small>{candidate.caseType}・{candidate.officialStatus}</small></button>)}</div>}</Modal>}
    {officeManagerOpen && <AccountingOfficeManager onClose={() => setOfficeManagerOpen(false)} />}
    </main></div>
  </div>;
}
