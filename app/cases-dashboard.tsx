"use client";

import { useEffect, useState } from "react";

type Stage = "name_precheck" | "city_government" | "national_tax" | "completed";
type Employee = { id: number; name: string };
export type CaseItem = { id: number; companyName: string; summary: string; employeeId: number; employeeName: string; status: "ongoing" | "completed"; stage: Stage; progress: number; updatedAt: string; completedAt?: string; bonusTwd: number };
type Dashboard = { month: string; completedCount: number; bonusTotal: number; bonusPerCase: number; employees: (Employee & { completedCount: number; bonusTotal: number })[] };

const stages: { value: Stage; label: string; progress: number }[] = [
  { value: "name_precheck", label: "名稱預查", progress: 20 },
  { value: "city_government", label: "市政府", progress: 55 },
  { value: "national_tax", label: "國稅局", progress: 85 },
  { value: "completed", label: "已結案", progress: 100 },
];

export default function CasesDashboard({ onOpenWizard }: { onOpenWizard: (item: CaseItem) => void }) {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [cases, setCases] = useState<CaseItem[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [history, setHistory] = useState<CaseItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [currentUser, setCurrentUser] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [draft, setDraft] = useState({ companyName: "", summary: "", employeeId: "" });
  const [filters, setFilters] = useState({ month: "", employeeId: "", company: "" });

  const load = async () => {
    setLoading(true); setError("");
    try {
      const query = new URLSearchParams({ history: "1" });
      if (filters.month) query.set("month", filters.month);
      if (filters.employeeId) query.set("employeeId", filters.employeeId);
      if (filters.company) query.set("company", filters.company);
      const [dashboardResponse, activeResponse, historyResponse] = await Promise.all([fetch("/api/cases/dashboard"), fetch("/api/cases"), fetch(`/api/cases?${query}`)]);
      if (!dashboardResponse.ok || !activeResponse.ok || !historyResponse.ok) throw new Error("案件資料讀取失敗，請稍後再試。");
      const dashboardData = await dashboardResponse.json() as Dashboard;
      const activeData = await activeResponse.json() as { cases: CaseItem[]; employees: Employee[] };
      const historyData = await historyResponse.json() as { cases: CaseItem[] };
      setDashboard(dashboardData); setCases(activeData.cases); setEmployees(activeData.employees); setHistory(historyData.cases);
      setCurrentUser((value) => value || activeData.employees[0]?.name || "");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "案件資料讀取失敗。"); }
    finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, [filters.month, filters.employeeId, filters.company]);

  const update = async (id: number, body: object, confirmText?: string) => {
    if (confirmText && !confirm(confirmText)) return;
    try {
      const response = await fetch(`/api/cases/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (!response.ok) throw new Error("案件更新失敗，請稍後再試。");
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "案件更新失敗。"); }
  };

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const response = await fetch("/api/cases", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...draft, employeeId: Number(draft.employeeId), stage: "name_precheck" }) });
      if (!response.ok) throw new Error("建立案件失敗，請確認資料。");
      setDraft({ companyName: "", summary: "", employeeId: "" }); setShowNew(false); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "建立案件失敗。"); }
  };

  return <main className="cases-main"><header className="cases-header"><div><p className="eyebrow">公司登記案件管理</p><h1>工商案件清單</h1><p>從名稱預查、市政府到國稅局，清楚追蹤每一件公司的目前進度。</p></div><label>目前使用者<select value={currentUser} onChange={(event) => setCurrentUser(event.target.value)}>{employees.map((employee) => <option key={employee.id}>{employee.name}</option>)}</select></label></header>
    {error && <p className="case-error">{error}</p>}{loading && <p className="case-loading">資料讀取中…</p>}
    {dashboard && <section className="metric-grid"><article><span>本月完成工商</span><strong>{dashboard.completedCount} 家</strong></article><article><span>每家工商獎金</span><strong>NT$ {dashboard.bonusPerCase}</strong></article><article><span>本月獎金合計</span><strong>NT$ {dashboard.bonusTotal}</strong></article></section>}
    <section className="case-panel"><h2>本月各員工完成件數</h2><div className="employee-grid">{dashboard?.employees.map((employee) => <div key={employee.id}><strong>{employee.name}</strong><span>{employee.completedCount} 家・NT$ {employee.bonusTotal}</span></div>)}</div></section>
    <section className="case-panel"><div className="panel-heading"><div><h2>進行中案件</h2><p>進度分為：名稱預查 → 市政府 → 國稅局 → 已結案。</p></div><button className="primary" onClick={() => setShowNew(!showNew)}>{showNew ? "取消新增" : "新增案件"}</button></div>
      {showNew && <form className="new-case" onSubmit={create}><input required placeholder="公司名稱" value={draft.companyName} onChange={(event) => setDraft({ ...draft, companyName: event.target.value })}/><input required placeholder="案件摘要，例如：冷凍、配管工程" value={draft.summary} onChange={(event) => setDraft({ ...draft, summary: event.target.value })}/><select required value={draft.employeeId} onChange={(event) => setDraft({ ...draft, employeeId: event.target.value })}><option value="">選擇承辦員工</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</select><button className="primary">建立案件</button></form>}
      <div className="case-list">{!loading && !cases.length ? <p>目前沒有進行中的案件。</p> : cases.map((item) => <article key={item.id}><div><h3>{item.companyName}</h3><p>{item.summary}</p><small>更新日期：{new Date(item.updatedAt).toLocaleDateString("zh-TW")}</small></div><label>承辦人<select value={item.employeeId} onChange={(event) => void update(item.id, { employeeId: Number(event.target.value) })}>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</select></label><label>目前進度<select value={item.stage} onChange={(event) => { const stage = event.target.value as Stage; if (stage === "completed") void update(item.id, { action: "complete" }, "確定將此案件標示為已結案？結案後將計入 NT$500 工商獎金。"); else void update(item.id, { stage }); }}>{stages.map((stage) => <option key={stage.value} value={stage.value}>{stage.label}</option>)}</select></label><div className="stage-track">{stages.map((stage) => <span key={stage.value} className={stages.findIndex((entry) => entry.value === item.stage) >= stages.findIndex((entry) => entry.value === stage.value) ? "done" : ""}>{stage.label}</span>)}</div><div className="progress"><span style={{ width: `${item.progress}%` }}/><small>{item.progress}%</small></div><div className="case-actions"><button className="secondary" onClick={() => onOpenWizard(item)}>進入文件流程</button><button className="primary" onClick={() => void update(item.id, { action: "complete" }, "確定將此案件標示為已結案？結案後將計入 NT$500 工商獎金。")}>已結案</button></div></article>)}</div>
    </section>
    <section className="case-panel"><h2>歷史紀錄</h2><div className="history-filters"><input type="month" value={filters.month} onChange={(event) => setFilters({ ...filters, month: event.target.value })}/><select value={filters.employeeId} onChange={(event) => setFilters({ ...filters, employeeId: event.target.value })}><option value="">全部員工</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</select><input placeholder="搜尋公司名稱" value={filters.company} onChange={(event) => setFilters({ ...filters, company: event.target.value })}/></div>{!loading && !history.length ? <p>尚無符合條件的結案紀錄。</p> : <div className="history-list">{history.map((item) => <article key={item.id}><div><strong>{item.companyName}</strong><span>{item.employeeName}・結案日 {item.completedAt ? new Date(item.completedAt).toLocaleDateString("zh-TW") : "—"}・獎金 NT$ {item.bonusTwd}</span></div><button className="secondary" onClick={() => void update(item.id, { action: "restore" }, "確定恢復此案件？案件將回到國稅局階段。")}>恢復案件</button></article>)}</div>}</section>
  </main>;
}
