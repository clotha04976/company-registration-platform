import { useCallback, useEffect, useMemo, useState } from "react";
import { Building2, CheckCircle2, Download, FileText, Save, Settings2 } from "lucide-react";
import AccountingOfficeManager, { AccountingOffice } from "./accounting-office-manager";

type RocDate = { year: string; month: string; day: string };
type PurchaseSettings = {
  officeId: number | null;
  page4OfficeId: number | null;
  taxRegistrationNumber: string;
  responsiblePersonId: string;
  businessPhone: string;
  email: string;
  taxBureauName: string;
  branchName: string;
  salesDocumentNumber: string;
  applicationDate: RocDate;
  officialDate: RocDate;
  selectedPages: number[];
  checkboxes: Record<string, unknown>;
  generatedAt: string;
  updatedAt: string;
};
type PurchaseData = {
  case: {
    id: number;
    caseNumber: string;
    companyName: string;
    taxId: string;
    representative: string;
    address: string;
  };
  settings: PurchaseSettings;
  offices: AccountingOffice[];
  nationalTaxApprovalReceived: boolean;
};

const pages = [
  [1, "領用統一發票購票證申請書"],
  [2, "營業人委任代理委任書"],
  [3, "集中購買統一發票申請書"],
  [4, "委任專業代理人查詢下載電子發票相關業務申請書"],
] as const;
const checkboxGroups = [
  {
    title: "第 1 頁・登記類型",
    single: true,
    options: [
      ["page1.registration.establishment", "設立"],
      ["page1.registration.change", "變更登記"],
      ["page1.registration.other", "其他核准字號"],
    ],
  },
  {
    title: "第 1 頁・領用原因",
    single: true,
    options: [
      ["page1.reason.new", "新領"],
      ["page1.reason.change", "變更登記換發"],
      ["page1.reason.lost", "遺失補發"],
      ["page1.reason.damaged", "毀損補發"],
      ["page1.reason.other", "其他"],
    ],
  },
  {
    title: "第 1 頁・附件與領取人",
    single: false,
    options: [
      ["page1.attachments.responsibleIdOriginal", "負責人身分證正本"],
      ["page1.attachments.agentPickup", "委託代理人領取"],
      ["page1.relation.responsible", "負責人領取"],
      ["page1.relation.agent", "代理人領取"],
      ["page1.relation.employee", "員工領取"],
      ["page1.relation.otherOffice", "其他／事務所領取"],
    ],
  },
  {
    title: "第 1 頁・請領統一發票",
    single: false,
    options: [
      ["page1.invoiceTypes.twoCopy", "二聯式"],
      ["page1.invoiceTypes.threeCopy", "三聯式"],
      ["page1.invoiceTypes.twoCopyRegister", "二聯式收銀機"],
      ["page1.invoiceTypes.threeCopyRegister", "三聯式收銀機"],
      ["page1.invoiceTypes.special", "特種"],
    ],
  },
  {
    title: "第 2 頁・委任內容",
    single: false,
    options: [
      ["page2.services.purchase", "購買統一發票"],
      ["page2.services.receiveCertificate", "領取統一發票購票證"],
      ["page2.actions.purchase", "代理購買統一發票"],
      ["page2.actions.receiveCertificate", "代理領取購票證"],
    ],
  },
] as const;

const nestedBoolean = (source: Record<string, unknown>, path: string) =>
  path.split(".").reduce<unknown>((value, key) =>
    value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined,
  source) === true;

const withNestedBoolean = (source: Record<string, unknown>, path: string, value: boolean) => {
  const next = structuredClone(source);
  const keys = path.split(".");
  let cursor = next;
  keys.forEach((key, index) => {
    if (index === keys.length - 1) cursor[key] = value;
    else {
      if (!cursor[key] || typeof cursor[key] !== "object") cursor[key] = {};
      cursor = cursor[key] as Record<string, unknown>;
    }
  });
  return next;
};

function DateFields({ label, value, onChange }: { label: string; value: RocDate; onChange: (value: RocDate) => void }) {
  const patch = (key: keyof RocDate, next: string) => onChange({ ...value, [key]: next.replace(/\D/g, "") });
  return <fieldset className="purchase-date-fields"><legend>{label}</legend><div><label>民國年<input inputMode="numeric" value={value.year} onChange={(event) => patch("year", event.target.value)} /></label><label>月<input inputMode="numeric" value={value.month} onChange={(event) => patch("month", event.target.value)} /></label><label>日<input inputMode="numeric" value={value.day} onChange={(event) => patch("day", event.target.value)} placeholder="可留白" /></label></div></fieldset>;
}

export default function PurchaseProofApplication({ caseId }: { caseId: number }) {
  const [data, setData] = useState<PurchaseData | null>(null);
  const [form, setForm] = useState<PurchaseSettings | null>(null);
  const [state, setState] = useState<"loading" | "idle" | "saving" | "downloading" | "error">("loading");
  const [message, setMessage] = useState("");
  const [officeManagerOpen, setOfficeManagerOpen] = useState(false);

  const load = useCallback(async () => {
    setState("loading");
    setMessage("");
    try {
      const response = await fetch(`/api/cases/${caseId}/purchase-proof`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || "購票證明資料載入失敗");
      setData(payload);
      setForm(payload.settings);
      setState("idle");
    } catch (reason) {
      setState("error");
      setMessage(reason instanceof Error ? reason.message : "購票證明資料載入失敗");
    }
  }, [caseId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const activeOffices = useMemo(() => data?.offices.filter((office) => office.active) ?? [], [data]);
  const patch = <K extends keyof PurchaseSettings>(key: K, value: PurchaseSettings[K]) =>
    setForm((current) => current ? { ...current, [key]: value } : current);

  const togglePage = (page: number) => {
    if (!form) return;
    const selectedPages = form.selectedPages.includes(page)
      ? form.selectedPages.filter((value) => value !== page)
      : [...form.selectedPages, page].sort((left, right) => left - right);
    patch("selectedPages", selectedPages);
  };

  const toggleCheckbox = (path: string, checked: boolean, group: typeof checkboxGroups[number]) => {
    if (!form) return;
    let next = form.checkboxes;
    if (group.single) {
      for (const [optionPath] of group.options) next = withNestedBoolean(next, optionPath, optionPath === path);
    } else next = withNestedBoolean(next, path, checked);
    patch("checkboxes", next);
  };

  const requestPayload = () => form ? {
    ...form,
    officeId: Number(form.officeId) || null,
    page4OfficeId: Number(form.page4OfficeId) || Number(form.officeId) || null,
  } : null;

  const save = async () => {
    const payload = requestPayload();
    if (!payload) return;
    setState("saving");
    setMessage("");
    try {
      const response = await fetch(`/api/cases/${caseId}/purchase-proof`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "購票證明設定儲存失敗");
      setState("idle");
      setMessage("購票證明設定已儲存");
    } catch (reason) {
      setState("error");
      setMessage(reason instanceof Error ? reason.message : "購票證明設定儲存失敗");
    }
  };

  const download = async () => {
    const payload = requestPayload();
    if (!payload || !data) return;
    setState("downloading");
    setMessage("");
    try {
      const response = await fetch(`/api/cases/${caseId}/purchase-proof/docx`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const failure = await response.json().catch(() => ({}));
        throw new Error(failure.message || "購票證明 Word 產生失敗");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `購票證明申請-${data.case.companyName}.docx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setState("idle");
      setMessage(`Word 已產生，共 ${form?.selectedPages.length ?? 0} 頁`);
      await load();
    } catch (reason) {
      setState("error");
      setMessage(reason instanceof Error ? reason.message : "購票證明 Word 產生失敗");
    }
  };

  if (state === "loading" && !form) return <section className="purchase-proof-panel"><p className="case-loading">購票證明資料載入中…</p></section>;
  if (!data || !form) return <section className="purchase-proof-panel"><p className="case-error">{message || "購票證明資料載入失敗"}</p></section>;

  return <section className="purchase-proof-panel">
    <header><div><p className="eyebrow">FINAL STEP · PURCHASE PROOF</p><h3>購票證明申請套版</h3><p>國稅局核准後，選擇受任事務所並下載四頁可編輯 Word。</p></div><button className="secondary small" onClick={() => setOfficeManagerOpen(true)}><Settings2 size={15} />管理事務所</button></header>
    <div className={data.nationalTaxApprovalReceived ? "purchase-gate ready" : "purchase-gate"}>{data.nationalTaxApprovalReceived ? <CheckCircle2 size={18} /> : <FileText size={18} />}<span><strong>{data.nationalTaxApprovalReceived ? "國稅局公文已收到，可以產生購票證明" : "等待國稅局核准公文"}</strong><small>{data.nationalTaxApprovalReceived ? "請確認以下資料後下載 Word。" : "請先在上方將國稅局公文標記為「已收到／已歸檔」並儲存。"}</small></span></div>
    <div className="purchase-case-summary"><span><small>案件</small><strong>{data.case.companyName}</strong></span><span><small>統一編號</small><strong>{data.case.taxId || "尚未填寫"}</strong></span><span><small>負責人</small><strong>{data.case.representative || "尚未填寫"}</strong></span><span><small>地址</small><strong>{data.case.address || "尚未填寫"}</strong></span></div>
    <div className="purchase-form-grid">
      <label>受任事務所<select value={form.officeId ?? ""} onChange={(event) => patch("officeId", Number(event.target.value) || null)}><option value="">請選擇</option>{activeOffices.map((office) => <option key={office.id} value={office.id}>{office.name}</option>)}</select></label>
      <label>第 4 頁專業代理人事務所<select value={form.page4OfficeId ?? ""} onChange={(event) => patch("page4OfficeId", Number(event.target.value) || null)}><option value="">同樣請選擇</option>{activeOffices.map((office) => <option key={office.id} value={office.id}>{office.name}</option>)}</select></label>
      <label>稅籍編號<input value={form.taxRegistrationNumber} onChange={(event) => patch("taxRegistrationNumber", event.target.value)} /></label>
      <label>公司負責人身分證字號<input maxLength={10} value={form.responsiblePersonId} onChange={(event) => patch("responsiblePersonId", event.target.value.toUpperCase())} /></label>
      <label>營業人電話<input value={form.businessPhone} onChange={(event) => patch("businessPhone", event.target.value)} /></label>
      <label>營業人電子郵件<input type="email" value={form.email} onChange={(event) => patch("email", event.target.value)} /></label>
      <label>國稅局<select value={form.taxBureauName} onChange={(event) => patch("taxBureauName", event.target.value)}><option value="">請選擇</option>{["台北", "北區", "中區", "南區", "高雄"].map((name) => <option key={name}>{name}</option>)}</select></label>
      <label>分局／稽徵所名稱<input value={form.branchName} onChange={(event) => patch("branchName", event.target.value)} /></label>
      <label className="span-2">公文銷售字號<input value={form.salesDocumentNumber} onChange={(event) => patch("salesDocumentNumber", event.target.value)} placeholder="只輸入字號數字" /></label>
    </div>
    <div className="purchase-date-grid"><DateFields label="申請日期" value={form.applicationDate} onChange={(value) => patch("applicationDate", value)} /><DateFields label="國稅局公文日期" value={form.officialDate} onChange={(value) => patch("officialDate", value)} /></div>
    <div className="purchase-page-options">{pages.map(([id, title]) => <label key={id} className={form.selectedPages.includes(id) ? "selected" : ""}><input type="checkbox" checked={form.selectedPages.includes(id)} onChange={() => togglePage(id)} /><span>第 {id} 頁</span><strong>{title}</strong></label>)}</div>
    <div className="purchase-checkbox-groups">{checkboxGroups.map((group) => <fieldset key={group.title}><legend>{group.title}</legend><div>{group.options.map(([path, label]) => <label key={path}><input type={group.single ? "radio" : "checkbox"} name={group.single ? group.title : undefined} checked={nestedBoolean(form.checkboxes, path)} onChange={(event) => toggleCheckbox(path, event.target.checked, group)} /><span>{label}</span></label>)}</div></fieldset>)}</div>
    {message && <p className={state === "error" ? "case-error" : "completion-note"}>{message}</p>}
    <footer className="purchase-actions"><button className="secondary" disabled={state === "saving" || state === "downloading"} onClick={() => void save()}><Save size={16} />{state === "saving" ? "儲存中…" : "儲存設定"}</button><button className="primary" disabled={!data.nationalTaxApprovalReceived || state === "saving" || state === "downloading" || !form.selectedPages.length} onClick={() => void download()}><Download size={16} />{state === "downloading" ? "Word 產生中…" : "下載購票證明 Word"}</button></footer>
    {!activeOffices.length && <p className="purchase-office-warning"><Building2 size={16} />尚未建立事務所，請先按「管理事務所」。</p>}
    {officeManagerOpen && <AccountingOfficeManager onClose={() => setOfficeManagerOpen(false)} onChanged={() => void load()} />}
  </section>;
}
