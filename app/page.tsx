"use client";

import { ChangeEvent, DragEvent, KeyboardEvent, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, ArrowRight, Check, CheckCircle2, ChevronRight, CircleHelp, Download, FileCheck2, FileText, LockKeyhole, Plus, ShieldCheck, Trash2, UploadCloud, UserRound } from "lucide-react";

type FileStatus = "waiting" | "processing" | "success" | "manual";
type PreviewKey = "aml" | "shareholder" | "director";
type UploadItem = { id: string; file: File; status: FileStatus; progress: number; note?: string };
type BusinessItem = { id: string; code: string; name: string };
type OutputKey = "company_application" | "registration_form" | "name_reservation" | "articles" | "shareholder" | "director" | "aml" | "id_attachment" | "building_consent" | "house_tax" | "land_title" | "capital_certificate" | "registration_card_city" | "registration_card_return";

const initialBusiness: BusinessItem[] = [
  { id: "1", code: "E599010", name: "配管工程業" }, { id: "2", code: "E601010", name: "電器承裝業" },
  { id: "3", code: "E603050", name: "自動控制設備工程業" }, { id: "4", code: "E603090", name: "照明設備安裝工程業" },
  { id: "5", code: "IG03010", name: "能源技術服務業" }, { id: "6", code: "ZZ99999", name: "除許可業務外，得經營法令非禁止或限制之業務" },
];

const outputList: { key: OutputKey; label: string; kind: "form" | "attachment" | "external" }[] = [
  { key: "company_application", label: "公司設立登記申請書", kind: "form" }, { key: "registration_form", label: "公司設立登記表", kind: "form" },
  { key: "name_reservation", label: "公司名稱及所營事業預查核定書", kind: "form" }, { key: "articles", label: "公司章程", kind: "form" },
  { key: "shareholder", label: "股東同意書", kind: "form" }, { key: "director", label: "董事願任同意書", kind: "form" },
  { key: "aml", label: "AML 防制洗錢確認書", kind: "form" }, { key: "id_attachment", label: "身分證明文件附件", kind: "attachment" },
  { key: "building_consent", label: "建物所有人同意書", kind: "external" }, { key: "house_tax", label: "房屋稅單", kind: "external" },
  { key: "land_title", label: "土地權狀", kind: "external" }, { key: "capital_certificate", label: "會計師資本額簽證", kind: "external" },
  { key: "registration_card_city", label: "登記事項卡（市政府留存）", kind: "external" }, { key: "registration_card_return", label: "登記事項卡（蓋章後寄回客戶）", kind: "external" },
];

const supportedExtensions = new Set(["pdf", "jpg", "jpeg", "png", "webp"]);
const knownFileWords = ["預查", "身分證", "章程", "股東同意", "董事願任", "防制洗錢", "房屋稅", "建物所有人", "土地權狀", "資本額", "會計師", "登記表", "申請書"];
const formatBytes = (value: number) => value < 1024 * 1024 ? `${Math.max(1, Math.round(value / 1024))} KB` : `${(value / 1024 / 1024).toFixed(1)} MB`;
const downloadText = (fileName: string, content: string) => {
  const blob = new Blob(["\ufeff", content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = `${fileName}.txt`; document.body.appendChild(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
};
function DateNotice({ capitalDate = false }: { capitalDate?: boolean }) {
  return <div className="date-notice"><CircleHelp size={16}/>{capitalDate ? "日期為存入資本額日期，請先留空" : "日期可填寫簽名當天日期"}</div>;
}

function Preview({ tab, company, representative, nationalId, contactAddress }: { tab: PreviewKey; company: string; representative: string; nationalId: string; contactAddress: string }) {
  if (tab === "aml") return <article className="paper"><div className="paper-label"><ShieldCheck size={16}/>防制洗錢確認書</div><h2>防制洗錢確認書</h2><p>茲就資本簽證事宜，依會計師防制洗錢辦法之規定，敘明下列之情事以供會計師使用。</p><h3>一、基本資料</h3><p>姓名：{representative}　身分證字號：{nationalId}</p><p>地址：{contactAddress}</p><h3>二、重要政治性職務人士</h3><p>□否　□是，請說明：＿＿＿＿＿＿＿＿</p><h3>三、合法資金來源</h3><p>□繼承財產　□商業經營獲利　□出售不動產　□薪資　□其他</p><p className="paper-sign">立書人：＿＿＿＿＿＿＿＿（親簽）<br/>日期：＿＿年＿＿月＿＿日</p><DateNotice /></article>;
  if (tab === "shareholder") return <article className="paper consent-paper"><div className="paper-label"><FileText size={16}/>股東同意書</div><h2>{company}<br/>股東同意書</h2><table><thead><tr><th>申請事項</th><th>同意內容</th></tr></thead><tbody><tr><td>公司設立</td><td>茲同意設立{company}，訂定公司章程，並選任{representative}為董事。</td></tr></tbody></table><div className="seal-space"><span>公司大章空位</span><small>（加蓋公司印章）</small></div><table><thead><tr><th>股東姓名</th><th>親自簽名</th></tr></thead><tbody><tr><td>{representative}</td><td></td></tr></tbody></table><p className="paper-date">日期：＿＿年＿＿月＿＿日</p><DateNotice capitalDate /></article>;
  return <article className="paper director-paper"><div className="paper-label"><UserRound size={16}/>董事願任同意書</div><h2>董事願任同意書</h2><p className="director-text">本人同意擔任{company}董事。</p><p className="signature-place">（本人親自簽名）</p><p className="director-name">立同意書人：{representative}</p><p className="paper-date director-date">日期：＿＿年＿＿月＿＿日</p><p className="paper-footnote">有限公司之董事，依公司法第八條第一項規定為公司之負責人。</p><DateNotice capitalDate /></article>;
}

export default function Home() {
  const [step, setStep] = useState(1);
  const [files, setFiles] = useState<UploadItem[]>([]);
  const [recognitionDone, setRecognitionDone] = useState(false);
  const [recognising, setRecognising] = useState(false);
  const [preview, setPreview] = useState<PreviewKey>("aml");
  const inputRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({ company: "範例工程有限公司", representative: "王小明", precheck: "115004506", approval: "115/01/22", expiry: "115/07/21", capital: "1,000,000", nationalId: "A1••••••734", contactAddress: "桃園市桃園區（完整地址待確認）", registrationAddress: "臺中市南區（完整地址待確認）" });
  const [business, setBusiness] = useState<BusinessItem[]>(initialBusiness);
  const [saved, setSaved] = useState(false);

  const formIssues = useMemo(() => {
    const labels: Record<keyof typeof form, string> = { company: "公司名稱", representative: "負責人姓名", precheck: "預查編號", approval: "核准日期", expiry: "核准有效期限", capital: "資本總額", nationalId: "身分證字號", contactAddress: "負責人聯絡地址", registrationAddress: "公司登記地址" };
    const missing = (Object.keys(form) as (keyof typeof form)[]).filter((key) => !form[key].trim()).map((key) => labels[key]);
    if (business.some((item) => !item.code.trim() || !item.name.trim())) missing.push("所營事業資料");
    return missing;
  }, [business, form]);
  const manualFiles = files.filter((item) => item.status === "manual");
  const successFiles = files.filter((item) => item.status === "success");
  const formComplete = formIssues.length === 0;
  const hasFile = (...words: string[]) => successFiles.some((item) => words.some((word) => item.file.name.includes(word)));
  const outputState = (item: typeof outputList[number]) => {
    if (item.key === "company_application") return formComplete ? { ready: true, reason: "共用資料完整，可下載草稿" } : { ready: false, reason: `待補：${formIssues.join("、")}` };
    if (item.key === "registration_form") return formComplete ? { ready: true, reason: "登記資料完整，可下載草稿" } : { ready: false, reason: `待補：${formIssues.join("、")}` };
    if (item.key === "name_reservation") return form.precheck.trim() ? { ready: true, reason: "已有預查編號與核准資料" } : { ready: false, reason: "待補：預查資料" };
    if (item.key === "articles") return form.company.trim() && form.capital.trim() && business.length ? { ready: true, reason: "章程所需資料完整" } : { ready: false, reason: "待補：公司名稱、資本額或營業項目" };
    if (item.key === "shareholder" || item.key === "director") return form.company.trim() && form.representative.trim() ? { ready: true, reason: "公司名稱與負責人已確認" } : { ready: false, reason: "待補：公司名稱或負責人" };
    if (item.key === "aml") return form.representative.trim() && form.nationalId.trim() && form.contactAddress.trim() ? { ready: true, reason: "負責人基本資料已確認" } : { ready: false, reason: "待補：負責人基本資料" };
    if (item.key === "id_attachment") return hasFile("身分證") ? { ready: true, reason: "已收到身分證附件" } : { ready: false, reason: "待補：負責人身分證附件" };
    if (item.key === "building_consent") return hasFile("建物所有人") ? { ready: true, reason: "已收到建物所有人同意書" } : { ready: false, reason: "待補：建物所有人同意書" };
    if (item.key === "house_tax") return hasFile("房屋稅") ? { ready: true, reason: "已收到房屋稅單" } : { ready: false, reason: "待補：房屋稅單" };
    if (item.key === "land_title") return hasFile("土地權狀") ? { ready: true, reason: "已收到土地權狀" } : { ready: false, reason: "待補：土地權狀" };
    if (item.key === "capital_certificate") return hasFile("資本額簽證", "會計師") ? { ready: true, reason: "已收到會計師資本額簽證" } : { ready: false, reason: "待補：會計師資本額簽證" };
    return { ready: false, reason: "市政府送件後才會取得或完成" };
  };
  const outputStates = outputList.map((item) => ({ ...item, ...outputState(item) }));
  const readyCount = outputStates.filter((item) => item.ready).length;

  const addFiles = (incoming: FileList | null) => {
    if (!incoming?.length) return;
    const next = Array.from(incoming).map((file) => ({ id: `${file.name}-${file.lastModified}-${Math.random()}`, file, status: "waiting" as FileStatus, progress: 0 }));
    setFiles((current) => [...current, ...next]); setRecognitionDone(false); setSaved(false);
  };
  const handleDrop = (event: DragEvent<HTMLDivElement>) => { event.preventDefault(); addFiles(event.dataTransfer.files); };
  const keyUpload = (event: KeyboardEvent<HTMLDivElement>) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); inputRef.current?.click(); } };
  const startRecognition = () => {
    if (!files.length || recognising) return;
    setRecognising(true); setRecognitionDone(false);
    setFiles((current) => current.map((item) => ({ ...item, status: "processing", progress: 8, note: undefined })));
    files.forEach((item, index) => {
      window.setTimeout(() => {
        const extension = item.file.name.split(".").pop()?.toLowerCase() ?? "";
        const success = supportedExtensions.has(extension) && knownFileWords.some((word) => item.file.name.includes(word));
        setFiles((current) => current.map((entry) => entry.id === item.id ? { ...entry, status: success ? "success" : "manual", progress: 100, note: success ? "已完成資料擷取，請核對欄位" : "未知檔案格式，需人工確認；未套用 OCR 結果" } : entry));
        if (index === files.length - 1) { setRecognising(false); setRecognitionDone(true); }
      }, 650 * (index + 1));
    });
  };
  const updateForm = (key: keyof typeof form, value: string) => { setForm((current) => ({ ...current, [key]: value })); setSaved(false); };
  const changeBusiness = (id: string, key: "code" | "name", value: string) => { setBusiness((current) => current.map((item) => item.id === id ? { ...item, [key]: value } : item)); setSaved(false); };
  const saveStepTwo = () => { setSaved(true); setStep(3); };
  const genericContent = useMemo(() => `公司設立登記文件草稿\n\n公司名稱：${form.company}\n負責人：${form.representative}\n預查編號：${form.precheck}\n核准日期：${form.approval}\n核准有效期限：${form.expiry}\n資本總額：${form.capital}\n負責人聯絡地址：${form.contactAddress}\n公司登記地址：${form.registrationAddress}\n\n所營事業\n${business.map((item) => `${item.code} ${item.name}`).join("\n")}`, [business, form]);
  const getContent = (key: OutputKey) => {
    if (key === "aml") return `防制洗錢確認書（預覽文字檔）\n\n立書人：${form.representative}\n身分證字號：${form.nationalId}\n地址：${form.contactAddress}\n簽名：＿＿＿＿＿＿＿＿\n日期：＿＿年＿＿月＿＿日\n\n提醒：日期可填寫簽名當天日期`;
    if (key === "shareholder") return `${form.company}\n股東同意書（預覽文字檔）\n\n茲同意設立${form.company}，訂定公司章程，並選任${form.representative}為董事。\n\n公司大章空位：\n\n\n\n（加蓋公司印章）\n\n股東姓名：${form.representative}\n親自簽名：＿＿＿＿＿＿＿＿\n日期：＿＿年＿＿月＿＿日\n\n提醒：日期為存入資本額日期，請先留空`;
    if (key === "director") return `董事願任同意書（預覽文字檔）\n\n本人同意擔任${form.company}董事。\n\n立同意書人：${form.representative}\n親自簽名：＿＿＿＿＿＿＿＿\n日期：＿＿年＿＿月＿＿日\n\n提醒：日期為存入資本額日期，請先留空`;
    return genericContent;
  };
  const getOutput = (item: typeof outputStates[number]) => {
    const pending = `待補文件\n\n${item.label}\n\n${item.reason}\n\n請補齊後重新確認。`;
    downloadText(item.ready ? item.key : `${item.key}-待補`, item.ready ? getContent(item.key) : pending);
  };

  return <main>
    <header className="topbar"><div className="brand"><span>企</span><strong>公司設立登記智慧精靈</strong><em>PRIVATE PREVIEW</em></div><div className="browser-note"><LockKeyhole size={15}/>本預覽在瀏覽器暫時處理，離開後不保存</div></header>
    <section className="hero"><div><p className="eyebrow">公司設立登記流程 · CR-2026-071</p><h1>{form.company}</h1><p>先上傳資料，再逐欄確認，最後下載市政府送件應備書件。</p></div><aside><strong>正式系統架構</strong><span>Vue.js + FastAPI + SQLite</span></aside></section>
    <nav className="wizard" aria-label="公司設立登記步驟">{[[1,"上傳與辨識"],[2,"確認公司資料"],[3,"文件與下載"]].map(([number, label]) => <div key={number} className={step === number ? "active" : step > Number(number) ? "complete" : ""}><span>{step > Number(number) ? <Check size={15}/> : number}</span><strong>{label}</strong></div>)}</nav>
    {step === 1 && <section className="stage" aria-labelledby="step1-title"><div className="stage-heading"><div><p className="eyebrow">STEP 1</p><h2 id="step1-title">上傳文件並確認辨識結果</h2><p>支援 PDF 與常見圖片格式；不支援或未知格式不會假裝為 OCR 成功。</p></div><div className="privacy-chip"><ShieldCheck size={17}/>本畫面僅供流程示意</div></div><div className="upload-zone" role="button" tabIndex={0} onDrop={handleDrop} onDragOver={(event) => event.preventDefault()} onClick={() => inputRef.current?.click()} onKeyDown={keyUpload}><UploadCloud size={33}/><strong>拖曳檔案至此，或點擊選擇檔案</strong><span>支援多檔上傳；未知格式會改列為人工確認</span><input ref={inputRef} type="file" multiple onChange={(event: ChangeEvent<HTMLInputElement>) => addFiles(event.target.files)} aria-label="選擇上傳文件" /></div><div className="file-list" aria-live="polite">{files.length === 0 ? <p className="empty-row">尚未選擇文件。可先加入身分或公司相關的示意文件。</p> : files.map((item) => <div className="file-row" key={item.id}><FileText size={20}/><div><strong>{item.file.name}</strong><span>{item.file.type || "未知類型"} · {formatBytes(item.file.size)}</span>{item.status === "processing" && <i><b style={{ width: `${item.progress}%` }} /></i>}{item.note && <small className="file-note">{item.note}</small>}</div><em className={item.status}>{item.status === "waiting" ? "等待辨識" : item.status === "processing" ? `辨識中 ${item.progress}%` : item.status === "success" ? "辨識成功" : "需人工確認"}</em></div>)}</div><div className="recognition-note"><AlertTriangle size={18}/><span>辨識成功僅代表檔案格式可處理，仍請核對欄位；未知檔案一律標示「需人工確認」，不會產生或套用 OCR 結果。</span></div><footer className="stage-actions"><button className="secondary" disabled>上一步</button><div><button className="secondary" disabled={!files.length || recognising} onClick={startRecognition}>{recognising ? "正在辨識…" : "開始辨識"}</button><button className="primary" disabled={!recognitionDone || recognising} onClick={() => setStep(2)}>前往公司資料 <ArrowRight size={16}/></button></div></footer>{recognitionDone && <p className="completion-note"><CheckCircle2 size={17}/>處理完成：{successFiles.length} 份辨識成功，{manualFiles.length} 份需人工確認。</p>}</section>}
    {step === 2 && <section className="stage" aria-labelledby="step2-title"><div className="stage-heading"><div><p className="eyebrow">STEP 2</p><h2 id="step2-title">確認與修改擷取資料</h2><p>請逐欄核對來源文件；所有欄位都可直接修改。</p></div><div className="source-summary"><FileCheck2 size={17}/>已處理 {files.length} 份上傳文件</div></div><div className="expiry-alert"><AlertTriangle size={21}/><div><strong>名稱保留期限已屆滿</strong><span>核准保留期限為民國 115 年 07 月 21 日，送件前請先確認是否須重新辦理名稱預查。</span></div></div><div className="form-grid">{([['company','公司名稱','名稱預查核定書'],['representative','負責人','身分證／ERP'],['precheck','預查編號','名稱預查核定書'],['approval','核准日期','名稱預查核定書'],['expiry','核准保留期限','名稱預查核定書'],['capital','資本總額','公司章程／資本額證明'],['nationalId','身分證字號','身分證附件'],['contactAddress','負責人聯絡地址','身分證／ERP'],['registrationAddress','公司登記地址','ERP／地址證明']] as [keyof typeof form,string,string][]).map(([key,label,source]) => <label key={key}><span>{label}<em>{source}</em></span><input value={form[key]} onChange={(event) => updateForm(key,event.target.value)} /></label>)}</div><section className="business-section"><div className="business-heading"><div><h3>所營事業項目</h3><p>請依預查核定內容確認代碼與名稱，可新增、修改或刪除。</p></div><button className="secondary small" onClick={() => { setBusiness((current) => [...current, { id: crypto.randomUUID(), code: "", name: "" }]); setSaved(false); }}><Plus size={15}/>新增項目</button></div><div className="business-list">{business.map((item,index) => <div key={item.id}><span>{index + 1}</span><input aria-label={`第 ${index + 1} 項代碼`} value={item.code} onChange={(event) => changeBusiness(item.id,"code",event.target.value)} /><input aria-label={`第 ${index + 1} 項名稱`} value={item.name} onChange={(event) => changeBusiness(item.id,"name",event.target.value)} /><button aria-label={`刪除第 ${index + 1} 項`} onClick={() => { setBusiness((current) => current.filter((entry) => entry.id !== item.id)); setSaved(false); }}><Trash2 size={16}/></button></div>)}</div></section><footer className="stage-actions"><button className="secondary" onClick={() => setStep(1)}><ArrowLeft size={16}/>上一步</button><button className="primary" onClick={saveStepTwo}>儲存並前往文件 <ArrowRight size={16}/></button></footer>{saved && <p className="completion-note"><CheckCircle2 size={17}/>已暫存本頁修改，可在下一步查看動態文件狀態。</p>}</section>}
    {step === 3 && <section className="stage" aria-labelledby="step3-title"><div className="stage-heading"><div><p className="eyebrow">STEP 3</p><h2 id="step3-title">下載市政府應備書件</h2><p>文件狀態會依目前表單完整度與上傳結果即時更新。</p></div><div className="ready-summary"><CheckCircle2 size={17}/>{readyCount} 份可下載 · {outputList.length-readyCount} 份待補</div></div><div className="output-list">{outputStates.map((item) => <div className="output-row" key={item.key}><div><span className={item.ready ? "output-ready" : "output-pending"}>{item.ready ? <Check size={15}/> : <AlertTriangle size={15}/>}</span><strong>{item.label}</strong><small>{item.reason}</small></div><button className={item.ready ? "download ready" : "download"} onClick={() => getOutput(item)}><Download size={16}/>{item.ready ? "下載預覽檔" : "下載待補說明"}</button></div>)}</div><section className="preview-section"><div><p className="eyebrow">文件預覽</p><h3>三份須簽署文件</h3><div className="preview-tabs" role="tablist">{([['aml','防制洗錢確認書'],['shareholder','股東同意書'],['director','董事願任同意書']] as [PreviewKey,string][]).map(([key,label]) => <button role="tab" aria-selected={preview === key} className={preview === key ? "selected" : ""} key={key} onClick={() => setPreview(key)}>{label}<ChevronRight size={15}/></button>)}</div></div><Preview tab={preview} company={form.company} representative={form.representative} nationalId={form.nationalId} contactAddress={form.contactAddress}/></section><footer className="stage-actions"><button className="secondary" onClick={() => setStep(2)}><ArrowLeft size={16}/>返回資料確認</button><button className="primary" onClick={() => setStep(1)}>建立下一個案件</button></footer></section>}
  </main>;
}
