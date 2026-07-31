"use client";

import { ChangeEvent, DragEvent, useRef, useState } from "react";
import {
  ArrowRight,
  BadgeCheck,
  CalendarDays,
  Check,
  ChevronRight,
  CircleAlert,
  Clock3,
  FileCheck2,
  FileText,
  FolderUp,
  Landmark,
  LockKeyhole,
  Plus,
  ShieldCheck,
  UploadCloud,
  UserRound,
} from "lucide-react";

type DocumentKey = "aml" | "shareholder" | "director";

const intakeFiles = [
  { name: "公司名稱及所營事業登記預查核定書_1150122.pdf", tag: "已辨識", tone: "success" },
  { name: "負責人身分證明文件", tag: "待上傳", tone: "pending" },
  { name: "公司所在地地址證明", tag: "待上傳", tone: "pending" },
  { name: "資本額存入證明", tag: "待補件", tone: "attention" },
];

const documentMeta: Record<DocumentKey, { label: string; state: string; icon: typeof FileText }> = {
  aml: { label: "防制洗錢確認書", state: "待確認", icon: ShieldCheck },
  shareholder: { label: "股東同意書", state: "資料已帶入", icon: Landmark },
  director: { label: "董事願任同意書", state: "資料已帶入", icon: UserRound },
};

function EmptyDateNotice({ shareholder = false }: { shareholder?: boolean }) {
  return (
    <div className="date-notice" role="note">
      <CalendarDays size={17} aria-hidden="true" />
      <span>{shareholder ? "日期為存入資本額日期，請先留空" : "日期可填寫簽名當天日期"}</span>
    </div>
  );
}

function DocumentPreview({ active }: { active: DocumentKey }) {
  if (active === "aml") {
    return (
      <article className="paper aml-paper" aria-label="防制洗錢確認書預覽">
        <div className="paper-heading"><ShieldCheck size={19} /> 文件預覽</div>
        <h2>防制洗錢確認書</h2>
        <p className="paper-intro">茲就資本簽證事宜，依會計師防制洗錢辦法之規定，敘明下列之情事以供會計師使用。</p>
        <section className="paper-section">
          <h3>一、基本資料</h3>
          <dl className="field-grid">
            <div><dt>姓名</dt><dd>王小明</dd></div>
            <div><dt>國籍</dt><dd><span className="checked">■</span> 本國人　□ 外國人</dd></div>
            <div><dt>身分證統編</dt><dd>A1••••••734</dd></div>
            <div><dt>住居所地址</dt><dd>桃園市桃園區（已遮罩）</dd></div>
          </dl>
        </section>
        <section className="paper-section">
          <h3>二、重要政治性職務人士</h3>
          <p>□ 否　　□ 是，請說明（擔任機關或組織名稱、職務、關係等）</p>
        </section>
        <section className="paper-section">
          <h3>三、合法資金來源</h3>
          <p>□ 繼承財產　□ 商業經營獲利　□ 出售不動產</p>
          <p>□ 股匯市投資　□ 薪資　□ 其他</p>
        </section>
        <div className="signature-row"><span>立書人：＿＿＿＿＿＿＿＿（親簽）</span><span>日期：＿＿＿年＿＿月＿＿日</span></div>
        <EmptyDateNotice />
      </article>
    );
  }

  if (active === "shareholder") {
    return (
      <article className="paper consent-paper" aria-label="股東同意書預覽">
        <div className="paper-heading"><Landmark size={19} /> 文件預覽</div>
        <h2><span>竤竣工程</span>有限公司<br />股東同意書</h2>
        <table>
          <thead><tr><th>申請事項</th><th>同意內容</th></tr></thead>
          <tbody><tr><td>公司設立</td><td>茲同意設立範例工程有限公司，訂定公司章程，並選任王小明為董事。</td></tr></tbody>
        </table>
        <div className="seal-zone">
          <p>公司大章留白區</p>
          <span>（加蓋公司印章）</span>
        </div>
        <table className="sign-table">
          <thead><tr><th>股東姓名</th><th>親自簽名</th></tr></thead>
          <tbody><tr><td>王小明</td><td></td></tr></tbody>
        </table>
        <div className="date-line">中　華　民　國　　＿＿＿年　＿＿月　＿＿日</div>
        <EmptyDateNotice shareholder />
      </article>
    );
  }

  return (
    <article className="paper director-paper" aria-label="董事願任同意書預覽">
      <div className="paper-heading"><UserRound size={19} /> 文件預覽</div>
      <h2>董事願任同意書</h2>
      <p className="director-copy">本人同意擔任範例工程有限公司董事。</p>
      <p className="director-sign">（本人親自簽名）</p>
      <p className="director-name">立同意書人：王小明</p>
      <p className="director-date">中　華　民　國　　＿＿＿年　＿＿月　＿＿日</p>
      <div className="paper-note"><strong>備註</strong>　有限公司之董事，依公司法第八條第一項規定為公司之負責人。</div>
      <EmptyDateNotice shareholder />
    </article>
  );
}

export default function Home() {
  const [activeDocument, setActiveDocument] = useState<DocumentKey>("aml");
  const [uploaded, setUploaded] = useState<string[]>(["公司名稱及所營事業登記預查核定書_1150122.pdf"]);
  const [selectedOutputs, setSelectedOutputs] = useState<DocumentKey[]>(["aml", "shareholder", "director"]);
  const [dropMessage, setDropMessage] = useState("拖曳檔案至此，或選擇本機檔案進行模擬上傳");
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = (files: FileList | null) => {
    if (!files?.length) return;
    const names = Array.from(files).map((file) => file.name);
    setUploaded((current) => Array.from(new Set([...current, ...names])));
    setDropMessage(`已加入 ${names.length} 份檔案，僅保留於此預覽畫面。`);
  };
  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => addFiles(event.target.files);
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    addFiles(event.dataTransfer.files);
  };
  const toggleOutput = (key: DocumentKey) => {
    setSelectedOutputs((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);
  };

  return (
    <main>
      <section className="topbar">
        <div className="brand"><span className="brand-mark">登</span><span>工商登記案件平台</span></div>
        <div className="topbar-meta"><LockKeyhole size={15} /> 預覽模式・未連接外部系統</div>
      </section>

      <header className="hero">
        <div>
          <p className="eyebrow">案件編號　CR-2026-071</p>
          <h1>範例工程有限公司 <span>設立登記</span></h1>
          <p className="hero-copy">集中核對收件資料，讓已知欄位自動帶入每一份對應申請文件。</p>
        </div>
        <div className="case-status"><BadgeCheck size={20} /><div><small>目前進度</small><strong>資料彙整中</strong></div></div>
      </header>

      <nav className="steps" aria-label="案件處理進度">
        {[["1", "文件收件", "current"], ["2", "資料核對", ""], ["3", "文件產出", ""], ["4", "送件準備", ""]].map(([number, label, state]) => <div className={`step ${state}`} key={number}><span>{number}</span>{label}</div>)}
      </nav>

      <section className="overview" aria-label="案件總覽">
        <div className="overview-intro"><p className="section-kicker">案件總覽</p><h2>登記資料已建立，等待必要文件補齊</h2></div>
        <div className="overview-stats">
          <div><FileCheck2 size={18}/><strong>1 / 4</strong><span>收件完成</span></div>
          <div><Clock3 size={18}/><strong>3 份</strong><span>可預覽產出</span></div>
          <div><CircleAlert size={18}/><strong>2 項</strong><span>待確認事項</span></div>
        </div>
      </section>

      <div className="workspace">
        <section className="main-column">
          <section className="content-section intake-section">
            <div className="section-title"><div><p className="section-kicker">01・文件收件</p><h2>原始文件與收件狀態</h2></div><button className="text-button" onClick={() => inputRef.current?.click()}><Plus size={16}/> 模擬新增文件</button></div>
            <div className="dropzone" role="button" tabIndex={0} onClick={() => inputRef.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={onDrop} onKeyDown={(event) => event.key === "Enter" && inputRef.current?.click()}>
              <UploadCloud size={28}/><strong>上傳或拖放收件文件</strong><span>{dropMessage}</span><input ref={inputRef} type="file" multiple onChange={onFileChange} aria-label="選擇要模擬上傳的檔案" />
            </div>
            <div className="intake-list">
              {intakeFiles.map((file) => <div className="intake-row" key={file.name}><FileText size={18}/><span>{file.name}</span><em className={uploaded.includes(file.name) ? "success" : file.tone}>{uploaded.includes(file.name) ? "已加入預覽" : file.tag}</em></div>)}
            </div>
          </section>

          <section className="content-section extraction-section">
            <div className="section-title"><div><p className="section-kicker">02・名稱預查表</p><h2>擷取結果與欄位映射</h2></div><span className="demo-badge">正式核定資料</span></div>
            <p className="mapping-lead"><span><FileCheck2 size={17}/> 已從經濟部預查核定書擷取</span>以下資料將同步帶入設立申請表與各文件。</p>
            <div className="extraction-grid">
              <div><small>公司名稱</small><strong>範例工程有限公司</strong><span>→ 股東同意書、董事願任同意書</span></div>
              <div><small>預查編號／申請項目</small><strong>115004506・設立預查</strong><span>→ 公司設立申請表</span></div>
              <div><small>核准日期</small><strong>民國 115 年 01 月 22 日</strong><span>→ 預查資料欄</span></div>
              <div className="expired-field"><small>名稱核准保留期限</small><strong>民國 115 年 07 月 21 日</strong><span>名稱保留期限已屆滿</span></div>
            </div>
            <div className="expiry-alert" role="alert"><CircleAlert size={18}/><div><strong>名稱保留期限已屆滿</strong><span>目前日期為 2026/07/31，送件前請先確認是否須重新辦理名稱預查。</span></div></div>
            <div className="business-items">
              <small>核定所營事業項目（共 6 項）</small>
              <ol>
                <li><code>E599010</code> 配管工程業</li>
                <li><code>E601010</code> 電器承裝業</li>
                <li><code>E603050</code> 自動控制設備工程業</li>
                <li><code>E603090</code> 照明設備安裝工程業</li>
                <li><code>IG03010</code> 能源技術服務業</li>
                <li><code>ZZ99999</code> 除許可業務外，得經營法令非禁止或限制之業務</li>
              </ol>
              <span>→ 將依原核定順序帶入公司設立申請表與章程</span>
            </div>
            <div className="mapping-bar"><ArrowRight size={17}/><span>資料輸入一次後，已知欄位會自動帶入所有對應欄位；尚未確認的資料維持留白。</span></div>
          </section>

          <section className="content-section documents-section">
            <div className="section-title"><div><p className="section-kicker">03・文件產出</p><h2>選取並預覽待產文件</h2></div><button className="primary-button"><FolderUp size={17}/> 準備 {selectedOutputs.length} 份文件</button></div>
            <div className="document-layout">
              <div className="document-switcher" role="tablist" aria-label="文件預覽切換">
                {(Object.keys(documentMeta) as DocumentKey[]).map((key) => {
                  const meta = documentMeta[key]; const Icon = meta.icon; const selected = activeDocument === key;
                  return <div className={`document-choice ${selected ? "selected" : ""}`} key={key}>
                    <label><input type="checkbox" checked={selectedOutputs.includes(key)} onChange={() => toggleOutput(key)} aria-label={`選取產出：${meta.label}`} /><span className="custom-check">{selectedOutputs.includes(key) && <Check size={13}/>}</span></label>
                    <button role="tab" aria-selected={selected} onClick={() => setActiveDocument(key)}><Icon size={19}/><span><strong>{meta.label}</strong><small>{meta.state}</small></span><ChevronRight size={17}/></button>
                  </div>;
                })}
              </div>
              <DocumentPreview active={activeDocument} />
            </div>
          </section>
        </section>

        <aside className="sidebar">
          <section className="shared-card">
            <p className="section-kicker">共用資料卡</p><h2>本案已知資料</h2>
            <dl>
              <div><dt>公司名稱</dt><dd>範例工程有限公司</dd></div>
              <div><dt>負責人／董事</dt><dd>王小明</dd></div>
              <div><dt>國籍</dt><dd>本國人</dd></div>
              <div><dt>身分證統編</dt><dd>A1••••••734</dd></div>
              <div><dt>公司地址</dt><dd>待地址證明確認</dd></div>
            </dl>
            <button className="outline-button">檢視資料映射 <ArrowRight size={15}/></button>
          </section>
          <section className="attention-card"><CircleAlert size={19}/><div><strong>待確認事項</strong><p>資本額證明尚未收件；所有文件日期暫不自動填入。</p></div></section>
          <section className="architecture-card"><p className="section-kicker">正式系統架構</p><strong>Vue.js + FastAPI + SQLite</strong><span>本畫面為前端互動預覽，資料不會送往 ERP。</span></section>
        </aside>
      </div>
    </main>
  );
}
