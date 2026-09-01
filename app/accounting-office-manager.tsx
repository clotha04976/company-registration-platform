import { useCallback, useEffect, useState } from "react";
import { Building2, CheckCircle2, Pencil, Plus, Save, X } from "lucide-react";

export type AccountingOffice = {
  id: number;
  name: string;
  shortName: string;
  unifiedNumber: string;
  responsiblePerson: string;
  responsiblePersonId: string;
  address: string;
  phone: string;
  email: string;
  qualificationType: "bookkeeper" | "accountant" | "tax_agent";
  mediaCode: string;
  licenseNumber: string;
  isDefault: boolean;
  active: boolean;
};

type OfficeForm = Omit<AccountingOffice, "id">;

const emptyOffice = (): OfficeForm => ({
  name: "",
  shortName: "",
  unifiedNumber: "",
  responsiblePerson: "",
  responsiblePersonId: "",
  address: "",
  phone: "",
  email: "",
  qualificationType: "bookkeeper",
  mediaCode: "",
  licenseNumber: "",
  isDefault: false,
  active: true,
});

const qualificationLabels = {
  bookkeeper: "記帳士",
  accountant: "會計師",
  tax_agent: "記帳及報稅代理業務人",
};

export default function AccountingOfficeManager({
  onClose,
  onChanged,
}: {
  onClose: () => void;
  onChanged?: () => void;
}) {
  const [offices, setOffices] = useState<AccountingOffice[]>([]);
  const [editor, setEditor] = useState<{ id?: number; form: OfficeForm } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/accounting-offices");
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "事務所資料載入失敗");
      setOffices(data.offices ?? []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "事務所資料載入失敗");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const edit = (office?: AccountingOffice) =>
    setEditor({
      id: office?.id,
      form: office
        ? {
            name: office.name,
            shortName: office.shortName,
            unifiedNumber: office.unifiedNumber,
            responsiblePerson: office.responsiblePerson,
            responsiblePersonId: office.responsiblePersonId,
            address: office.address,
            phone: office.phone,
            email: office.email,
            qualificationType: office.qualificationType,
            mediaCode: office.mediaCode,
            licenseNumber: office.licenseNumber,
            isDefault: office.isDefault,
            active: office.active,
          }
        : emptyOffice(),
    });

  const patch = <K extends keyof OfficeForm>(key: K, value: OfficeForm[K]) =>
    setEditor((current) =>
      current ? { ...current, form: { ...current.form, [key]: value } } : current,
    );

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editor) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(
        editor.id ? `/api/accounting-offices/${editor.id}` : "/api/accounting-offices",
        {
          method: editor.id ? "PUT" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(editor.form),
        },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "事務所資料儲存失敗");
      setEditor(null);
      setMessage(editor.id ? "事務所資料已更新" : "事務所已新增");
      await load();
      onChanged?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "事務所資料儲存失敗");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="erp-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="erp-modal wide office-manager"
        role="dialog"
        aria-modal="true"
        aria-label="記帳士事務所設定"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <p className="eyebrow">OFFICE PROFILES</p>
            <h2>記帳士事務所設定</h2>
          </div>
          <button className="erp-icon-button" aria-label="關閉" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div className="office-manager-toolbar">
          <p>可建立多間事務所；每個案件產生購票證明時再選擇受任事務所。</p>
          <button className="primary" onClick={() => edit()}>
            <Plus size={16} />新增事務所
          </button>
        </div>
        {error && <p className="case-error">{error}</p>}
        {message && <p className="completion-note">{message}</p>}
        {loading ? (
          <p className="erp-loading">事務所資料載入中…</p>
        ) : offices.length ? (
          <div className="office-profile-list">
            {offices.map((office) => (
              <article key={office.id} className={!office.active ? "inactive" : ""}>
                <div className="office-profile-icon"><Building2 size={20} /></div>
                <div>
                  <strong>{office.name}</strong>
                  <span>{qualificationLabels[office.qualificationType]}・{office.responsiblePerson || "負責人未填"}</span>
                  <small>{office.unifiedNumber || "統編未填"}・{office.phone || "電話未填"}</small>
                </div>
                <div className="office-profile-tags">
                  {office.isDefault && <em><CheckCircle2 size={13} />預設</em>}
                  {!office.active && <em className="muted">停用</em>}
                </div>
                <button className="secondary small" onClick={() => edit(office)}>
                  <Pencil size={14} />編輯
                </button>
              </article>
            ))}
          </div>
        ) : (
          <div className="erp-empty office-empty">
            <Building2 size={30} />
            <h3>尚未建立事務所</h3>
            <p>先新增一間事務所，購票證明才有受任人資料可套版。</p>
          </div>
        )}
        {editor && (
          <form className="office-editor" onSubmit={save}>
            <div className="office-editor-heading">
              <div><p className="eyebrow">{editor.id ? "EDIT OFFICE" : "NEW OFFICE"}</p><h3>{editor.id ? "編輯事務所" : "新增事務所"}</h3></div>
              <button type="button" className="erp-icon-button" aria-label="關閉編輯" onClick={() => setEditor(null)}><X size={16} /></button>
            </div>
            <div className="erp-form-grid">
              <label className="span-2">事務所完整名稱<input required value={editor.form.name} onChange={(event) => patch("name", event.target.value)} /></label>
              <label>簡稱<input value={editor.form.shortName} onChange={(event) => patch("shortName", event.target.value)} /></label>
              <label>統一編號<input inputMode="numeric" maxLength={8} value={editor.form.unifiedNumber} onChange={(event) => patch("unifiedNumber", event.target.value.replace(/\D/g, ""))} /></label>
              <label>負責人姓名<input value={editor.form.responsiblePerson} onChange={(event) => patch("responsiblePerson", event.target.value)} /></label>
              <label>負責人身分證字號<input maxLength={10} value={editor.form.responsiblePersonId} onChange={(event) => patch("responsiblePersonId", event.target.value.toUpperCase())} /></label>
              <label>專業資格<select value={editor.form.qualificationType} onChange={(event) => patch("qualificationType", event.target.value as OfficeForm["qualificationType"])}><option value="bookkeeper">記帳士</option><option value="accountant">會計師</option><option value="tax_agent">記帳及報稅代理業務人</option></select></label>
              <label>證書字號<input value={editor.form.licenseNumber} onChange={(event) => patch("licenseNumber", event.target.value)} /></label>
              <label>媒體代號<input value={editor.form.mediaCode} onChange={(event) => patch("mediaCode", event.target.value)} /></label>
              <label>電話<input value={editor.form.phone} onChange={(event) => patch("phone", event.target.value)} /></label>
              <label className="span-2">地址<input value={editor.form.address} onChange={(event) => patch("address", event.target.value)} /></label>
              <label className="span-2">電子郵件<input type="email" value={editor.form.email} onChange={(event) => patch("email", event.target.value)} /></label>
              <label className="check-row"><input type="checkbox" checked={editor.form.isDefault} onChange={(event) => patch("isDefault", event.target.checked)} />設為預設事務所</label>
              <label className="check-row"><input type="checkbox" checked={editor.form.active} onChange={(event) => patch("active", event.target.checked)} />目前啟用</label>
            </div>
            <footer className="erp-form-actions">
              <button type="button" className="secondary" onClick={() => setEditor(null)}>取消</button>
              <button className="primary" disabled={busy}><Save size={16} />{busy ? "儲存中…" : "儲存事務所"}</button>
            </footer>
          </form>
        )}
      </section>
    </div>
  );
}
