"use client";

import { ChangeEvent, useEffect, useState } from "react";
import { ArrowLeft, Eye, Save } from "lucide-react";
import { extractDocument } from "../lib/document-extraction.mjs";

type Agency = "city_government" | "national_tax";
type ApprovalStatus = "not_received" | "received" | "archived";
type Approval = {
  status: ApprovalStatus;
  approvalDate: string;
  documentNumber: string;
  cloudPath: string;
};
type Tracking = {
  approvals: Record<Agency, Approval>;
  registrationCard: { originalReceived: boolean; customerCopySent: boolean };
};

const emptyTracking = (): Tracking => ({
  approvals: {
    city_government: {
      status: "not_received",
      approvalDate: "",
      documentNumber: "",
      cloudPath: "",
    },
    national_tax: {
      status: "not_received",
      approvalDate: "",
      documentNumber: "",
      cloudPath: "",
    },
  },
  registrationCard: { originalReceived: false, customerCopySent: false },
});
const accepted = ".pdf,.jpg,.jpeg,.png,.doc,.docx";
const runExtraction = extractDocument as unknown as (
  file: File,
  onUpdate: (update: { progress: number; message: string }) => void,
) => Promise<{ pages: { page: number; text: string }[] }>;
type Recognition = {
  status: "idle" | "working" | "review" | "error";
  progress: number;
  message: string;
};
const emptyRecognition = (): Record<Agency, Recognition> => ({
  city_government: { status: "idle", progress: 0, message: "" },
  national_tax: { status: "idle", progress: 0, message: "" },
});
const isoDate = (year: number, month: number, day: number) => {
  const westernYear = year < 1911 ? year + 1911 : year;
  const value = `${westernYear.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
  const date = new Date(`${value}T00:00:00Z`);
  return date.getUTCFullYear() === westernYear &&
    date.getUTCMonth() + 1 === month &&
    date.getUTCDate() === day
    ? value
    : "";
};
export const extractApprovalFields = (text: string) => {
  const documentNumber =
    text.match(/(?:發文字號|文號)\s*[:：]?\s*([^\s，。]{3,60})/)?.[1] ?? "";
  const chineseDate = text.match(
    /(?:中華民國\s*)?(\d{2,4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/,
  );
  const numericDate = text.match(/\b(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})\b/);
  const match = chineseDate ?? numericDate;
  return {
    documentNumber,
    approvalDate: match
      ? isoDate(Number(match[1]), Number(match[2]), Number(match[3]))
      : "",
  };
};

export default function ApprovalTracking({
  caseId,
  onBack,
}: {
  caseId: number | null;
  onBack: () => void;
}) {
  const [tracking, setTracking] = useState<Tracking>(emptyTracking);
  const [localFiles, setLocalFiles] = useState<Partial<Record<Agency, File>>>(
    {},
  );
  const [recognition, setRecognition] =
    useState<Record<Agency, Recognition>>(emptyRecognition);
  const [state, setState] = useState<
    "idle" | "loading" | "saving" | "saved" | "error"
  >("idle");
  const [message, setMessage] = useState("");

  useEffect(() => {
    setLocalFiles({});
    setRecognition(emptyRecognition());
    if (!caseId) return;
    let active = true;
    setState("loading");
    fetch(`/api/cases/${caseId}/approvals`)
      .then(async (response) => {
        if (!response.ok) throw new Error("核准公文追蹤資料載入失敗");
        return response.json();
      })
      .then((data) => {
        if (!active) return;
        setTracking({
          approvals: {
            city_government: {
              ...emptyTracking().approvals.city_government,
              ...data.approvals.city_government,
              approvalDate: data.approvals.city_government.approvalDate ?? "",
              documentNumber:
                data.approvals.city_government.documentNumber ?? "",
              cloudPath: data.approvals.city_government.cloudPath ?? "",
            },
            national_tax: {
              ...emptyTracking().approvals.national_tax,
              ...data.approvals.national_tax,
              approvalDate: data.approvals.national_tax.approvalDate ?? "",
              documentNumber: data.approvals.national_tax.documentNumber ?? "",
              cloudPath: data.approvals.national_tax.cloudPath ?? "",
            },
          },
          registrationCard: data.registrationCard,
        });
        setState("idle");
      })
      .catch((error) => {
        if (!active) return;
        setMessage(
          error instanceof Error ? error.message : "核准公文追蹤資料載入失敗",
        );
        setState("error");
      });
    return () => {
      active = false;
    };
  }, [caseId]);

  const setApproval = (agency: Agency, patch: Partial<Approval>) =>
    setTracking((current) => ({
      ...current,
      approvals: {
        ...current.approvals,
        [agency]: { ...current.approvals[agency], ...patch },
      },
    }));
  const chooseFile = async (
    agency: Agency,
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    setLocalFiles((current) => ({ ...current, [agency]: file }));
    if (!file) return;
    setRecognition((current) => ({
      ...current,
      [agency]: { status: "working", progress: 0, message: "公文辨識中…" },
    }));
    try {
      const result = await runExtraction(file, (update) =>
        setRecognition((current) => ({
          ...current,
          [agency]: {
            status: "working",
            progress: update.progress,
            message: update.message,
          },
        })),
      );
      const fields = extractApprovalFields(
        result.pages.map((page) => page.text).join("\n"),
      );
      if (!fields.documentNumber && !fields.approvalDate)
        throw new Error("未辨識到公文字號或核准日期，請人工填寫");
      setApproval(agency, {
        ...(fields.documentNumber
          ? { documentNumber: fields.documentNumber }
          : {}),
        ...(fields.approvalDate ? { approvalDate: fields.approvalDate } : {}),
      });
      setRecognition((current) => ({
        ...current,
        [agency]: {
          status: "review",
          progress: 100,
          message: "已帶入辨識結果，請人工確認核准日期與公文字號",
        },
      }));
    } catch (error) {
      setRecognition((current) => ({
        ...current,
        [agency]: {
          status: "error",
          progress: 100,
          message:
            error instanceof Error
              ? error.message
              : "辨識失敗，請人工填寫核准日期與公文字號",
        },
      }));
    }
  };
  const preview = (file: File) => {
    const url = URL.createObjectURL(file);
    window.open(url, "_blank", "noopener");
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };
  const save = async () => {
    if (!caseId) return;
    setState("saving");
    setMessage("");
    try {
      const response = await fetch(`/api/cases/${caseId}/approvals`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(tracking),
      });
      if (!response.ok)
        throw new Error((await response.json()).error || "儲存失敗");
      setState("saved");
      setMessage("核准公文追蹤已儲存");
    } catch (error) {
      setState("error");
      setMessage(
        error instanceof Error ? error.message : "核准公文追蹤儲存失敗",
      );
    }
  };
  const copyCloudPath = async (agency: Agency) => {
    try {
      await navigator.clipboard.writeText(tracking.approvals[agency].cloudPath);
      setState("saved");
      setMessage("雲端路徑已複製");
    } catch {
      setState("error");
      setMessage("雲端路徑複製失敗，請手動複製");
    }
  };

  if (!caseId)
    return (
      <section className="stage">
        <p className="eyebrow">STEP 4</p>
        <h2>核准公文追蹤</h2>
        <p className="case-error">
          請先從案件首頁進入案件，才能載入及儲存核准公文追蹤。
        </p>
        <button className="secondary" onClick={onBack}>
          <ArrowLeft size={16} />
          返回下載文件
        </button>
      </section>
    );

  return (
    <section className="stage approval-tracking">
      <p className="eyebrow">STEP 4</p>
      <h2>核准公文追蹤</h2>
      <p>記錄市政府與國稅局核准公文，以及登記事項卡寄送進度。</p>
      {state === "loading" && <p className="case-loading">追蹤資料載入中…</p>}
      {(["city_government", "national_tax"] as Agency[]).map((agency) => {
        const title =
          agency === "city_government" ? "市政府核准公文" : "國稅局核准公文";
        const item = tracking.approvals[agency];
        const file = localFiles[agency];
        return (
          <fieldset className="approval-card" key={agency}>
            <legend>{title}</legend>
            <div className="approval-grid">
              <label>
                公文狀態
                <select
                  value={item.status}
                  onChange={(event) =>
                    setApproval(agency, {
                      status: event.target.value as ApprovalStatus,
                    })
                  }
                >
                  <option value="not_received">尚未收到</option>
                  <option value="received">已收到</option>
                  <option value="archived">已歸檔</option>
                </select>
              </label>
              <label>
                核准日期
                <input
                  type="date"
                  value={item.approvalDate}
                  onChange={(event) =>
                    setApproval(agency, { approvalDate: event.target.value })
                  }
                />
              </label>
              <label>
                公文字號
                <input
                  maxLength={120}
                  value={item.documentNumber}
                  onChange={(event) =>
                    setApproval(agency, { documentNumber: event.target.value })
                  }
                />
              </label>
              <label>
                雲端路徑
                <input
                  maxLength={500}
                  placeholder="貼上公司雲端中的檔案路徑"
                  value={item.cloudPath}
                  onChange={(event) =>
                    setApproval(agency, { cloudPath: event.target.value })
                  }
                />
                <button
                  type="button"
                  className="secondary small copy-path"
                  disabled={!item.cloudPath.trim()}
                  onClick={() => void copyCloudPath(agency)}
                >
                  複製雲端路徑
                </button>
              </label>
            </div>
            <div className="approval-local-file">
              <label>
                本機公文檔案
                <input
                  type="file"
                  accept={accepted}
                  onChange={(event) => void chooseFile(agency, event)}
                />
              </label>
              {file && (
                <>
                  <span>{file.name}</span>
                  <button
                    className="secondary small"
                    onClick={() => preview(file)}
                  >
                    <Eye size={15} />
                    預覽
                  </button>
                </>
              )}
              <small>檔案僅供本次辨識／預覽，不會永久保存</small>
              {recognition[agency].status === "idle" ? (
                <small>選檔後會嘗試辨識；仍請人工確認核准日期與公文字號</small>
              ) : (
                <small className={`recognition-${recognition[agency].status}`}>
                  {recognition[agency].status === "working"
                    ? `${recognition[agency].progress}%・`
                    : ""}
                  {recognition[agency].message}
                </small>
              )}
            </div>
          </fieldset>
        );
      })}
      <fieldset className="approval-card">
        <legend>登記事項卡</legend>
        <label className="check-row">
          <input
            type="checkbox"
            checked={tracking.registrationCard.originalReceived}
            onChange={(event) =>
              setTracking((current) => ({
                ...current,
                registrationCard: {
                  ...current.registrationCard,
                  originalReceived: event.target.checked,
                },
              }))
            }
          />
          正本已收到
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={tracking.registrationCard.customerCopySent}
            onChange={(event) =>
              setTracking((current) => ({
                ...current,
                registrationCard: {
                  ...current.registrationCard,
                  customerCopySent: event.target.checked,
                },
              }))
            }
          />
          客戶份已寄出
        </label>
      </fieldset>
      {message && (
        <p className={state === "error" ? "case-error" : "completion-note"}>
          {message}
        </p>
      )}
      <footer className="stage-actions">
        <button className="secondary" onClick={onBack}>
          <ArrowLeft size={16} />
          返回下載文件
        </button>
        <button
          className="primary"
          disabled={state === "loading" || state === "saving"}
          onClick={() => void save()}
        >
          <Save size={16} />
          {state === "saving" ? "儲存中…" : "儲存追蹤資料"}
        </button>
      </footer>
    </section>
  );
}
