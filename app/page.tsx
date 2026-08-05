"use client";

import { ChangeEvent, DragEvent, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  Download,
  Eye,
  FileArchive,
  FileText,
  Trash2,
  UploadCloud,
} from "lucide-react";
import {
  buildDocx,
  buildRegistrationFormDocx,
  buildZip,
} from "../lib/ooxml.mjs";
import {
  extractDocument,
  parsePageRange,
  splitPdfPages,
} from "../lib/document-extraction.mjs";
import CasesDashboard from "./cases-dashboard";
import ApprovalTracking from "./approval-tracking";

type SlotKey =
  | "identity"
  | "name_reservation"
  | "passbook"
  | "address_bundle"
  | "capital_verification"
  | "other";
type Slot = {
  key: SlotKey;
  phase: "名稱預查階段" | "名稱核准後・市政府設立階段";
  title: string;
  purpose: string;
  multiple?: boolean;
};
type SlotFiles = Record<SlotKey, File[]>;
type ExtractionStatus =
  "pending" | "extracting" | "ocr" | "success" | "review" | "error";
type AddressCandidate = {
  address: string;
  sourceFile: string;
  page: number;
  pageRange: string;
  confidence: "高" | "中" | "低";
  evidence: string;
  score: number;
};
type DocumentDetection = {
  key: string;
  label: string;
  sourceFile: string;
  pageRange: string;
  evidence: string;
  score: number;
  confidence: "高" | "低";
};
type ExtractionResult = {
  status: "success" | "review" | "error";
  method: string;
  progress: number;
  message: string;
  pageCount: number;
  pages: { page: number; text: string }[];
  candidates: AddressCandidate[];
  detections: DocumentDetection[];
};
type FileExtractionState = {
  status: ExtractionStatus;
  progress: number;
  method: string;
  message: string;
  result?: ExtractionResult;
};
type GeneratedKey =
  "registration_form" | "articles" | "shareholder" | "director" | "aml";
type OutputItem = {
  key: string;
  label: string;
  kind: "generated" | "source" | "missing";
  generatedKey?: GeneratedKey;
  sourceSlots?: SlotKey[];
  reason?: string;
};

const slots: Slot[] = [
  {
    key: "identity",
    phase: "名稱預查階段",
    title: "負責人身分證明文件",
    purpose: "可上傳身分證正反面；系統將擷取姓名、身分證字號及聯絡地址。",
    multiple: true,
  },
  {
    key: "name_reservation",
    phase: "名稱預查階段",
    title: "公司名稱及所營事業登記預查核定書",
    purpose: "名稱核准後再上傳；系統將擷取公司名稱、營業項目及保留期限。",
  },
  {
    key: "passbook",
    phase: "名稱核准後・市政府設立階段",
    title: "籌備處存摺",
    purpose: "名稱預查核准後，客戶才能持核准名稱至銀行開立籌備處帳戶。",
  },
  {
    key: "address_bundle",
    phase: "名稱核准後・市政府設立階段",
    title: "租約／地址相關文件整包",
    purpose:
      "租約、房屋稅單、土地權狀、建物所有人同意書及平面圖，可分開掃描，也可合併為一份檔案上傳。系統辨識後請人工確認。",
    multiple: true,
  },
  {
    key: "capital_verification",
    phase: "名稱核准後・市政府設立階段",
    title: "會計師資本額簽證",
    purpose: "完成資本額查核後上傳。",
  },
  {
    key: "other",
    phase: "名稱核准後・市政府設立階段",
    title: "其他補充文件",
    purpose: "需要補件時可自行新增上傳。",
    multiple: true,
  },
];

const emptyFiles = (): SlotFiles =>
  Object.fromEntries(
    slots.map((slot) => [slot.key, []]),
  ) as unknown as SlotFiles;
const initialForm = {
  company: "範例工程有限公司",
  representative: "王小明",
  nationalId: "A123456789",
  precheck: "115004506",
  approval: "115/01/22",
  expiry: "115/07/21",
  contactAddress: "臺北市中正區範例路1號",
  registrationAddress: "",
  contactPhone: "",
  registrationPostalCode: "",
  contactPostalCode: "330018",
  capital: "1,000,000",
};
const initialBusiness = [
  "E599010 配管工程業",
  "E601010 電器承裝業",
  "E603050 自動控制設備工程業",
  "E603090 照明設備安裝工程業",
  "IG03010 能源技術服務業",
  "ZZ99999 除許可業務外，得經營法令非禁止或限制之業務",
];
const allowed = new Set(["pdf", "jpg", "jpeg", "png", "doc", "docx"]);
const ext = (file: File) => file.name.split(".").pop()?.toLowerCase() ?? "";
const supported = (file: File) => allowed.has(ext(file));
const fileSize = (value: number) =>
  value < 1024 * 1024
    ? `${Math.max(1, Math.round(value / 1024))} KB`
    : `${(value / 1024 / 1024).toFixed(1)} MB`;
const fileId = (file: File) => `${file.name}:${file.size}:${file.lastModified}`;
const runExtraction = extractDocument as unknown as (
  file: File,
  onUpdate: (update: {
    status: string;
    progress: number;
    method: string;
    message: string;
  }) => void,
) => Promise<ExtractionResult>;

const cityOutputs: OutputItem[] = [
  {
    key: "city_application",
    label: "公司設立登記申請書",
    kind: "missing",
    reason: "待提供正式範本，不納入批次下載",
  },
  {
    key: "city_registration_form",
    label: "公司設立登記表",
    kind: "generated",
    generatedKey: "registration_form",
  },
  {
    key: "precheck",
    label: "名稱預查核定書",
    kind: "source",
    sourceSlots: ["name_reservation"],
  },
  {
    key: "articles",
    label: "公司章程",
    kind: "generated",
    generatedKey: "articles",
  },
  {
    key: "shareholder",
    label: "股東同意書",
    kind: "generated",
    generatedKey: "shareholder",
  },
  {
    key: "director",
    label: "董事願任同意書",
    kind: "generated",
    generatedKey: "director",
  },
  {
    key: "aml",
    label: "防制洗錢確認書",
    kind: "generated",
    generatedKey: "aml",
  },
  {
    key: "identity",
    label: "負責人身分證",
    kind: "source",
    sourceSlots: ["identity"],
  },
  {
    key: "address",
    label: "租約及地址相關文件",
    kind: "source",
    sourceSlots: ["address_bundle"],
  },
  {
    key: "passbook",
    label: "籌備處存摺",
    kind: "source",
    sourceSlots: ["passbook"],
  },
  {
    key: "capital",
    label: "會計師資本額簽證",
    kind: "source",
    sourceSlots: ["capital_verification"],
  },
  {
    key: "registration_cards",
    label: "登記事項卡一式兩份",
    kind: "missing",
    reason: "待提供正式範本，不納入批次下載",
  },
];

const taxOutputs: OutputItem[] = [
  {
    key: "tax_application",
    label: "國稅局申請書",
    kind: "missing",
    reason: "目前由 ERP 轉出；待確認正式來源，不納入批次下載",
  },
  {
    key: "identity_tax",
    label: "負責人身分證",
    kind: "source",
    sourceSlots: ["identity"],
  },
  {
    key: "address_tax",
    label: "租約、房屋稅單、土地權狀、建物所有人同意書及平面圖",
    kind: "source",
    sourceSlots: ["address_bundle"],
  },
  {
    key: "articles_tax",
    label: "公司章程",
    kind: "generated",
    generatedKey: "articles",
  },
  {
    key: "shareholder_tax",
    label: "股東同意書",
    kind: "generated",
    generatedKey: "shareholder",
  },
  {
    key: "director_tax",
    label: "董事願任同意書",
    kind: "generated",
    generatedKey: "director",
  },
  {
    key: "city_card_copy",
    label: "市政府蓋章登記事項卡影本",
    kind: "missing",
    reason: "市政府核准後才會取得，不納入目前批次下載",
  },
  {
    key: "tax_registration_form",
    label: "登記表",
    kind: "missing",
    reason: "待提供正式範本，不納入批次下載",
  },
];

const saveBlob = (blob: Blob, name: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
};

export default function Home() {
  const [view, setView] = useState<"dashboard" | "wizard">("dashboard");
  const [step, setStep] = useState(1);
  const [activeCaseId, setActiveCaseId] = useState<number | null>(null);
  const [files, setFiles] = useState<SlotFiles>(emptyFiles);
  const [form, setForm] = useState(initialForm);
  const [business, setBusiness] = useState(initialBusiness);
  const [extractions, setExtractions] = useState<
    Record<string, FileExtractionState>
  >({});
  const [addressCandidates, setAddressCandidates] = useState<
    AddressCandidate[]
  >([]);
  const [selectedCandidate, setSelectedCandidate] = useState<string>("");
  const [detectionDecisions, setDetectionDecisions] = useState<
    Record<string, "confirmed" | "dismissed">
  >({});
  const [detectionPageRanges, setDetectionPageRanges] = useState<
    Record<string, string>
  >({});
  const addressManual = useRef(false);
  const activeAddressFiles = useRef(new Set<string>());
  const refs = useRef<Record<SlotKey, HTMLInputElement | null>>(
    {} as Record<SlotKey, HTMLInputElement | null>,
  );

  const validFiles = (key: SlotKey) => files[key].filter(supported);
  const applyCandidates = (
    sourceFile: string,
    candidates: AddressCandidate[],
  ) => {
    setAddressCandidates((current) => {
      const next = [
        ...current.filter((candidate) => candidate.sourceFile !== sourceFile),
        ...candidates,
      ].sort((a, b) => b.score - a.score);
      const top = next[0];
      if (top && !addressManual.current) {
        setSelectedCandidate(`${top.sourceFile}:${top.page}:${top.address}`);
        setForm((value) => ({ ...value, registrationAddress: top.address }));
      }
      if (!top && !addressManual.current) {
        setSelectedCandidate("");
        setForm((value) => ({ ...value, registrationAddress: "" }));
      }
      return next;
    });
  };
  const processAddressFile = async (file: File) => {
    const id = fileId(file);
    setExtractions((current) => ({
      ...current,
      [id]: {
        status: "pending",
        progress: 0,
        method: "等待處理",
        message: "準備在瀏覽器內辨識",
      },
    }));
    const result = await runExtraction(file, (update) => {
      if (!activeAddressFiles.current.has(id)) return;
      setExtractions((current) => ({
        ...current,
        [id]: {
          status: update.status as ExtractionStatus,
          progress: update.progress,
          method: update.method,
          message: update.message,
        },
      }));
    });
    if (!activeAddressFiles.current.has(id)) return;
    setExtractions((current) => ({
      ...current,
      [id]: {
        status: result.status,
        progress: result.progress,
        method: result.method,
        message: result.message,
        result,
      },
    }));
    applyCandidates(file.name, result.candidates);
  };
  const addFiles = (key: SlotKey, incoming: FileList | null) => {
    if (!incoming?.length) return;
    const multiple = slots.find((slot) => slot.key === key)?.multiple;
    const next = Array.from(incoming).filter(supported);
    const selected = multiple ? [...files[key], ...next] : next.slice(0, 1);
    setFiles((current) => ({ ...current, [key]: selected }));
    if (key === "address_bundle") {
      activeAddressFiles.current = new Set(selected.map(fileId));
      for (const file of next) void processAddressFile(file);
    }
  };
  const drop = (event: DragEvent<HTMLDivElement>, key: SlotKey) => {
    event.preventDefault();
    addFiles(key, event.dataTransfer.files);
  };
  const preview = (file: File) => {
    const url = URL.createObjectURL(file);
    window.open(url, "_blank", "noopener");
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };
  const removeFile = (slot: SlotKey, index: number) => {
    const removed = files[slot][index];
    const nextFiles = files[slot].filter((_, itemIndex) => itemIndex !== index);
    setFiles((current) => ({ ...current, [slot]: nextFiles }));
    if (slot !== "address_bundle" || !removed) return;
    const id = fileId(removed);
    activeAddressFiles.current.delete(id);
    setExtractions((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    setAddressCandidates((current) => {
      const next = current.filter(
        (candidate) => candidate.sourceFile !== removed.name,
      );
      const top = next[0];
      if (!addressManual.current) {
        setSelectedCandidate(
          top ? `${top.sourceFile}:${top.page}:${top.address}` : "",
        );
        setForm((value) => ({
          ...value,
          registrationAddress: top?.address ?? "",
        }));
      }
      return next;
    });
  };
  const extractedDetections = Object.values(extractions).flatMap(
    (state) => state.result?.detections ?? [],
  );
  const processingAddress = validFiles("address_bundle").some(
    (file) =>
      !["success", "review", "error"].includes(
        extractions[fileId(file)]?.status ?? "pending",
      ),
  );
  const detectionKey = (item: DocumentDetection) =>
    `${item.sourceFile}:${item.key}:${item.pageRange}`;
  const detectionRange = (item: DocumentDetection) =>
    detectionPageRanges[detectionKey(item)] ?? item.pageRange;
  const detectionApproved = (item: DocumentDetection) =>
    item.confidence === "高" ||
    detectionDecisions[detectionKey(item)] === "confirmed";
  const detectionRangeError = (item: DocumentDetection) => {
    const source = validFiles("address_bundle").find(
      (file) => file.name === item.sourceFile,
    );
    if (!source || ext(source) !== "pdf") return "";
    const pageCount = extractions[fileId(source)]?.result?.pageCount;
    if (!pageCount) return "頁碼超出文件範圍";
    try {
      parsePageRange(detectionRange(item), pageCount);
      return "";
    } catch (error) {
      return error instanceof Error ? error.message : "頁碼格式不正確";
    }
  };
  const downloadDetectedPdf = async (item: DocumentDetection) => {
    const source = validFiles("address_bundle").find(
      (file) => file.name === item.sourceFile,
    );
    if (!source) return;
    if (ext(source) !== "pdf") {
      saveBlob(source, source.name);
      return;
    }
    const result = extractions[fileId(source)]?.result;
    if (!result?.pageCount) return;
    try {
      const bytes = await splitPdfPages(
        new Uint8Array(await source.arrayBuffer()),
        detectionRange(item),
        result.pageCount,
      );
      saveBlob(
        new Blob([bytes as BlobPart], { type: "application/pdf" }),
        `${item.label}.pdf`,
      );
    } catch (error) {
      window.alert(
        error instanceof Error ? error.message : "頁碼無效，無法分割 PDF",
      );
    }
  };

  const docDefinition = (
    key: GeneratedKey,
  ): { name: string; lines: string[] } => {
    if (key === "shareholder")
      return {
        name: `${form.company}股東同意書`,
        lines: [
          `茲同意設立${form.company}，訂定公司章程，並選任${form.representative}為董事。`,
          `股東姓名：${form.representative}`,
          "公司大章：＿＿＿＿＿＿＿＿",
          "＿＿＿＿＿＿＿＿",
          "＿＿＿＿＿＿＿＿",
          "＿＿＿＿＿＿＿＿",
          "＿＿＿＿＿＿＿＿",
          "日期：民國＿＿年＿＿月＿＿日",
          "提醒：日期為存入資本額日期，請先留空",
        ],
      };
    if (key === "director")
      return {
        name: "董事願任同意書",
        lines: [
          `本人同意擔任${form.company}董事。`,
          `立同意書人：${form.representative}`,
          "親簽：＿＿＿＿＿＿＿＿",
          "日期：民國＿＿年＿＿月＿＿日",
          "提醒：日期為存入資本額日期，請先留空",
        ],
      };
    if (key === "aml")
      return {
        name: "防制洗錢確認書",
        lines: [
          `姓名：${form.representative}`,
          `身分證字號：${form.nationalId}`,
          `地址：${form.contactAddress}`,
          "職業：＿＿＿＿＿＿＿＿　電話：＿＿＿＿＿＿＿＿　Email：＿＿＿＿＿＿＿＿",
          "是否為 PEP：＿＿＿＿＿＿＿＿　資金來源：＿＿＿＿＿＿＿＿",
          "證明文件：＿＿＿＿＿＿＿＿",
          "身分證正反面附件：已由 Step 1 上傳文件沿用。",
          "親簽：＿＿＿＿＿＿＿＿",
          "日期：民國＿＿年＿＿月＿＿日",
          "提醒：日期可填寫簽名當天日期",
        ],
      };
    return {
      name: `${form.company}章程`,
      lines: [
        `第一條　本公司依照公司法規定組織之定名為${form.company}。`,
        "第二條　本公司所營事業如下：",
        ...business.map((item, index) => `${index + 1}. ${item}`),
        "第三條　本公司所在地設於台中市，必要時得在國內外設立分公司。",
        "第四條　本公司之公告方法依照公司法第廿八條規定辦理。",
        `第五條　本公司資本總額定為新台幣${form.capital}元整，全額繳足，各股東姓名、出資額如下：${form.representative}｜${form.capital}元整。`,
        "第五條之一　本公司為業務需要得對外保證。",
        "第六條　股東非得其他股東表決權過半數之同意，不得以其出資之全部或一部，轉讓於他人。董事非得其他股東表決權三分之二以上之同意，不得以其出資之全部或一部，轉讓於他人。",
        "第七條　本公司股東每出資新台幣壹仟元，有一表決權。",
        "第八條　本公司重要事項除公司法另有規定外經全體股東同意行之。",
        "第九條　本公司置董事一人執行業務並對外代表公司。",
        "第十條　本公司得設經理人，其委任、解任及報酬，依照公司法第廿九條規定辦理。",
        "第十一條　本公司每會計年度終了，董事應編造：(一)營業報告書、(二)財務報表、(三)盈餘分派或虧損撥補之議案送請各股東承認。",
        "第十二條　董事之報酬得於章程內訂明或依特約另定之。",
        "第十三條　公司年度如有獲利，應提撥新台幣壹仟元為員工酬勞。但公司尚有累積虧損時，應預先保留彌補數額。",
        "第十四條　本公司之盈餘及虧損按照各股東出資比例分派之。公司年度總決算如有盈餘，應先提繳稅款，彌補累積虧損，次提10%為法定盈餘公積，但法定盈餘公積金已達資本總額時，不在此限。其餘除派付股息外，如尚有盈餘，再由股東同意分配股東紅利。",
        "第十五條　本章程未盡事宜悉依照公司法及有關法令之規定辦理。",
        "第十六條　本章程訂立於民國＿＿年＿＿月＿＿日。",
        `公司名稱：${form.company}`,
        `董事：${form.representative}`,
      ],
    };
  };

  const docxBytes = (key: GeneratedKey) => {
    if (key === "registration_form")
      return {
        name: `${form.company}有限公司設立登記表.docx`,
        data: buildRegistrationFormDocx({ ...form, business }),
      };
    const def = docDefinition(key);
    return { name: `${def.name}.docx`, data: buildDocx(def.name, def.lines) };
  };
  const downloadGenerated = (key: GeneratedKey) => {
    const file = docxBytes(key);
    saveBlob(
      new Blob([file.data as BlobPart], {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
      file.name,
    );
  };
  const sourceFiles = (item: OutputItem) =>
    Array.from(
      new Set((item.sourceSlots ?? []).flatMap((slot) => validFiles(slot))),
    );
  const ready = (item: OutputItem) =>
    item.kind === "generated"
      ? Boolean(
          form.company &&
          form.representative &&
          (item.generatedKey !== "registration_form" ||
            form.registrationAddress) &&
          (item.generatedKey !== "aml" ||
            (form.nationalId && form.contactAddress)),
        )
      : item.kind === "source"
        ? sourceFiles(item).length > 0
        : false;

  const downloadItem = (item: OutputItem) => {
    if (item.kind === "generated" && item.generatedKey)
      return downloadGenerated(item.generatedKey);
    sourceFiles(item).forEach((file) => saveBlob(file, file.name));
  };

  const batchDownload = async (items: OutputItem[], filename: string) => {
    const entries: { name: string; data: Uint8Array }[] = [];
    const generated = new Set<GeneratedKey>();
    const originals = new Set<File>();
    for (const item of items) {
      if (!ready(item)) continue;
      if (
        item.kind === "generated" &&
        item.generatedKey &&
        !generated.has(item.generatedKey)
      ) {
        generated.add(item.generatedKey);
        entries.push(docxBytes(item.generatedKey));
      }
      if (
        item.kind === "source" &&
        !item.sourceSlots?.includes("address_bundle")
      )
        sourceFiles(item).forEach((file) => originals.add(file));
    }
    for (const source of validFiles("address_bundle")) {
      const sourceDetections = extractedDetections.filter(
        (item) =>
          item.sourceFile === source.name &&
          detectionDecisions[detectionKey(item)] !== "dismissed",
      );
      const approved = sourceDetections.filter(detectionApproved);
      let splitAdded = false;
      if (ext(source) === "pdf") {
        const result = extractions[fileId(source)]?.result;
        if (result?.pageCount)
          for (const item of approved)
            try {
              entries.push({
                name: `${item.label}.pdf`,
                data: await splitPdfPages(
                  new Uint8Array(await source.arrayBuffer()),
                  detectionRange(item),
                  result.pageCount,
                ),
              });
              splitAdded = true;
            } catch {
              originals.add(source);
            }
      }
      if (
        !splitAdded ||
        sourceDetections.some(
          (item) => item.confidence === "低" && !detectionApproved(item),
        )
      )
        originals.add(source);
    }
    for (const file of originals)
      entries.push({
        name: file.name,
        data: new Uint8Array(await file.arrayBuffer()),
      });
    if (!entries.length) return;
    saveBlob(
      new Blob([buildZip(entries) as BlobPart], { type: "application/zip" }),
      filename,
    );
  };

  const openWizard = (item: { id: number; companyName: string }) => {
    setActiveCaseId(item.id);
    setForm({
      company: item.companyName,
      representative: "",
      nationalId: "",
      precheck: "",
      approval: "",
      expiry: "",
      contactAddress: "",
      registrationAddress: "",
      contactPhone: "",
      registrationPostalCode: "",
      contactPostalCode: "",
      capital: "",
    });
    setBusiness([]);
    setFiles(emptyFiles());
    setExtractions({});
    setAddressCandidates([]);
    setSelectedCandidate("");
    setDetectionDecisions({});
    setDetectionPageRanges({});
    activeAddressFiles.current = new Set();
    addressManual.current = false;
    setStep(1);
    setView("wizard");
  };

  if (view === "dashboard") return <CasesDashboard onOpenWizard={openWizard} />;

  const renderOutputs = (
    title: string,
    subtitle: string,
    items: OutputItem[],
    action: () => void,
    button: string,
  ) => (
    <section className="output-group">
      <div className="panel-heading">
        <div>
          <h3>{title}</h3>
          <p>{subtitle}</p>
        </div>
        <button className="primary" onClick={action}>
          <FileArchive size={17} />
          {button}
        </button>
      </div>
      <div className="output-list">
        {items.map((item) => {
          const isReady = ready(item);
          return (
            <div className="output-row" key={item.key}>
              <div>
                <span className={isReady ? "output-ready" : "output-pending"}>
                  {isReady ? <Check size={15} /> : <AlertTriangle size={15} />}
                </span>
                <strong>{item.label}</strong>
                <small>
                  {isReady
                    ? item.kind === "generated"
                      ? "可下載 Word（.docx）"
                      : "使用已上傳的原始附件"
                    : item.generatedKey === "registration_form" &&
                        !form.registrationAddress
                      ? "待補公司所在地"
                      : (item.reason ?? "尚未上傳")}
                </small>
              </div>
              <button
                disabled={!isReady}
                className={isReady ? "download ready" : "download"}
                onClick={() => downloadItem(item)}
              >
                <Download size={16} />
                {isReady ? "下載" : "尚不可下載"}
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );

  return (
    <main>
      <button
        className="secondary back-dashboard"
        onClick={() => setView("dashboard")}
      >
        返回案件清單
      </button>
      <header className="hero">
        <div>
          <p className="eyebrow">公司設立登記作業</p>
          <h1>上傳、確認、一次下載</h1>
          <p>
            先依階段整理收到的資料，再確認擷取內容，最後下載可直接使用的送件文件。
          </p>
        </div>
      </header>
      <nav className="wizard">
        {["上傳資料", "確認公司資料", "下載送件文件", "核准公文追蹤"].map((label, index) => (
          <div
            key={label}
            className={
              step === index + 1 ? "active" : step > index + 1 ? "complete" : ""
            }
          >
            <span>{index + 1}</span>
            {label}
          </div>
        ))}
      </nav>
      {step === 1 && (
        <section className="stage">
          <div className="stage-heading">
            <div>
              <p className="eyebrow">STEP 1</p>
              <h2>依實際作業階段上傳</h2>
              <p>
                第一階段不要求租約或籌備處存摺；名稱核准後，再補齊銀行及設立地址相關資料。
              </p>
            </div>
          </div>
          {(["名稱預查階段", "名稱核准後・市政府設立階段"] as const).map(
            (phase) => (
              <section className="source-phase" key={phase}>
                <h3>{phase}</h3>
                {slots
                  .filter((slot) => slot.phase === phase)
                  .map((slot) => (
                    <div className="slot-card" key={slot.key}>
                      <div>
                        <strong>
                          {slot.title} <em className="optional">可稍後補</em>
                        </strong>
                        <small>{slot.purpose}</small>
                      </div>
                      <div
                        className="slot-drop"
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => drop(event, slot.key)}
                      >
                        <input
                          ref={(node) => {
                            refs.current[slot.key] = node;
                          }}
                          type="file"
                          multiple={slot.multiple}
                          accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                          onChange={(event: ChangeEvent<HTMLInputElement>) =>
                            addFiles(slot.key, event.target.files)
                          }
                        />
                        <button
                          className="secondary small"
                          onClick={() => refs.current[slot.key]?.click()}
                        >
                          <UploadCloud size={15} />
                          選擇檔案
                        </button>
                        <span>
                          {slot.multiple ? "可上傳多個檔案" : "限 1 個檔案"}
                        </span>
                      </div>
                      <div className="slot-files">
                        {files[slot.key].map((file, index) => (
                          <div
                            className="file-row"
                            key={`${file.name}-${index}`}
                          >
                            <FileText size={18} />
                            <div>
                              <strong>{file.name}</strong>
                              <span>
                                {ext(file).toUpperCase()}・{fileSize(file.size)}
                              </span>
                              {slot.key === "address_bundle" &&
                                extractions[fileId(file)] && (
                                  <small
                                    className={`extraction-status ${extractions[fileId(file)].status}`}
                                  >
                                    {extractions[fileId(file)].method}・
                                    {extractions[fileId(file)].progress}%・
                                    {extractions[fileId(file)].message}
                                    <i>
                                      <b
                                        style={{
                                          width: `${extractions[fileId(file)].progress}%`,
                                        }}
                                      />
                                    </i>
                                  </small>
                                )}
                            </div>
                            <button
                              aria-label="預覽"
                              onClick={() => preview(file)}
                            >
                              <Eye size={16} />
                            </button>
                            <button
                              aria-label="刪除"
                              onClick={() => removeFile(slot.key, index)}
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        ))}
                        {!files[slot.key].length && (
                          <small className="pending">尚未上傳</small>
                        )}
                      </div>
                    </div>
                  ))}
              </section>
            ),
          )}
          {validFiles("address_bundle").length > 0 && (
            <section className="link-suggestions">
              <div className="panel-heading">
                <div>
                  <h3>地址整包文件辨識</h3>
                  <p>
                    PDF 先讀取文字層；掃描 PDF 與圖片會在瀏覽器內以 OCR
                    處理，可能需要較長時間。檔案內容不會上傳第三方；OCR
                    執行元件及語言模型會以靜態資源載入。單檔上限 25 MB、PDF 上限
                    25 頁。
                  </p>
                </div>
              </div>
              {!processingAddress && addressCandidates.length === 0 && (
                <p className="recognition-note">
                  未辨識到公司所在地，請人工填寫
                </p>
              )}
              {extractedDetections.map((item: DocumentDetection) => {
                const decisionKey = detectionKey(item);
                const detectedSource = validFiles("address_bundle").find(
                  (file) => file.name === item.sourceFile,
                );
                if (detectionDecisions[decisionKey] === "dismissed")
                  return null;
                return (
                  <div key={decisionKey}>
                    <strong>{item.label}</strong>
                    <span>
                      {item.confidence === "高" ? "已辨識" : "待人工確認"}
                      ・信心：{item.confidence}・證據：{item.evidence}・
                      {item.sourceFile}
                    </span>
                    <input
                      aria-label={`${item.label}頁碼`}
                      value={detectionRange(item)}
                      onChange={(event) =>
                        setDetectionPageRanges((current) => ({
                          ...current,
                          [decisionKey]: event.target.value,
                        }))
                      }
                    />
                    {detectionRangeError(item) && (
                      <small className="address-failure">
                        {detectionRangeError(item)}
                      </small>
                    )}
                    {detectionApproved(item) ? (
                      <>
                        <button
                          className="secondary small"
                          disabled={Boolean(detectionRangeError(item))}
                          onClick={() => void downloadDetectedPdf(item)}
                        >
                          {detectedSource && ext(detectedSource) === "pdf"
                            ? "下載此文件 PDF"
                            : "下載原始圖片（圖片無法拆 PDF）"}
                        </button>
                        {item.confidence === "低" && (
                          <button
                            className="secondary small"
                            onClick={() =>
                              setDetectionDecisions((current) => {
                                const next = { ...current };
                                delete next[decisionKey];
                                return next;
                              })
                            }
                          >
                            取消確認
                          </button>
                        )}
                      </>
                    ) : (
                      <>
                        <button
                          className="primary small"
                          onClick={() =>
                            setDetectionDecisions((current) => ({
                              ...current,
                              [decisionKey]: "confirmed",
                            }))
                          }
                        >
                          確認包含
                        </button>
                        <button
                          className="secondary small"
                          onClick={() =>
                            setDetectionDecisions((current) => ({
                              ...current,
                              [decisionKey]: "dismissed",
                            }))
                          }
                        >
                          不包含
                        </button>
                      </>
                    )}
                  </div>
                );
              })}
              <div className="original-bundle-downloads">
                {validFiles("address_bundle").map((file) => (
                  <button
                    key={fileId(file)}
                    className="secondary small"
                    onClick={() => saveBlob(file, file.name)}
                  >
                    下載原始整包：{file.name}
                  </button>
                ))}
              </div>
            </section>
          )}
          <footer className="stage-actions">
            <button
              className="primary"
              disabled={processingAddress}
              onClick={() => setStep(2)}
            >
              下一步：確認資料
              <ArrowRight size={16} />
            </button>
          </footer>
        </section>
      )}
      {step === 2 && (
        <section className="stage">
          <p className="eyebrow">STEP 2</p>
          <h2>確認擷取資料</h2>
          <p>
            公司所在地可以稍後補。只有下載需要地址的正式文件時，系統才會要求填寫；不會阻擋名稱預查階段。
          </p>
          <div className="form-grid">
            {(Object.keys(form) as (keyof typeof form)[]).map((key) => (
              <label key={key}>
                <span>
                  {
                    {
                      company: "公司名稱",
                      representative: "負責人姓名",
                      nationalId: "身分證字號（完整顯示）",
                      precheck: "預查編號",
                      approval: "核准日期",
                      expiry: "名稱保留期限",
                      contactAddress: "負責人聯絡地址",
                      registrationAddress: "公司所在地（可稍後補）",
                      contactPhone: "公司電話（可留空）",
                      registrationPostalCode: "公司所在地郵遞區號（可留空）",
                      contactPostalCode: "負責人聯絡地址郵遞區號",
                      capital: "資本額",
                    }[key]
                  }
                </span>
                <input
                  value={form[key]}
                  onChange={(event) => {
                    if (key === "registrationAddress")
                      addressManual.current = true;
                    setForm((current) => ({
                      ...current,
                      [key]: event.target.value,
                    }));
                  }}
                />
                {key === "registrationAddress" &&
                  addressCandidates.length > 0 && (
                    <div className="address-candidates">
                      <small>
                        已保留 {addressCandidates.length}{" "}
                        個候選地址；可重新選擇來源。
                      </small>
                      {addressCandidates.map((candidate) => {
                        const candidateKey = `${candidate.sourceFile}:${candidate.page}:${candidate.address}`;
                        return (
                          <label key={candidateKey} className="candidate-row">
                            <input
                              type="radio"
                              name="registration-address-candidate"
                              checked={selectedCandidate === candidateKey}
                              onChange={() => {
                                addressManual.current = false;
                                setSelectedCandidate(candidateKey);
                                setForm((current) => ({
                                  ...current,
                                  registrationAddress: candidate.address,
                                }));
                              }}
                            />
                            <span>
                              <strong>{candidate.address}</strong>
                              <small>
                                來源：{candidate.sourceFile}・第{" "}
                                {candidate.pageRange} 頁・信心：
                                {candidate.confidence}
                              </small>
                              <small>證據：{candidate.evidence}</small>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                {key === "registrationAddress" &&
                  validFiles("address_bundle").length > 0 &&
                  !processingAddress &&
                  addressCandidates.length === 0 && (
                    <small className="address-failure">
                      未辨識到公司所在地，請人工填寫
                    </small>
                  )}
              </label>
            ))}
          </div>
          <section className="business-section">
            <h3>所營事業項目</h3>
            {business.map((item, index) => (
              <div className="business-list" key={`${index}-${item}`}>
                <input
                  value={item}
                  onChange={(event) =>
                    setBusiness((current) =>
                      current.map((entry, i) =>
                        i === index ? event.target.value : entry,
                      ),
                    )
                  }
                />
                <button
                  className="secondary small"
                  onClick={() =>
                    setBusiness((current) =>
                      current.filter((_, i) => i !== index),
                    )
                  }
                >
                  刪除
                </button>
              </div>
            ))}
            <button
              className="secondary small"
              onClick={() => setBusiness((current) => [...current, ""])}
            >
              新增營業項目
            </button>
          </section>
          <footer className="stage-actions">
            <button className="secondary" onClick={() => setStep(1)}>
              <ArrowLeft size={16} />
              上一步
            </button>
            <button className="primary" onClick={() => setStep(3)}>
              確認並前往下載
            </button>
          </footer>
        </section>
      )}
      {step === 3 && (
        <section className="stage">
          <p className="eyebrow">STEP 3</p>
          <h2>下載送件文件</h2>
          <p>
            產生的 Word 檔案為真正 OOXML `.docx`，可直接用 Microsoft Word
            開啟、修改及列印。批次下載只收錄目前可用的文件與原始附件。
          </p>
          <div className="all-download">
            <button
              className="primary"
              onClick={() =>
                void batchDownload(
                  [...cityOutputs, ...taxOutputs],
                  `${form.company}_全部可用文件.zip`,
                )
              }
            >
              <FileArchive size={18} />
              下載所有可用文件
            </button>
          </div>
          {renderOutputs(
            "市政府設立登記",
            "名稱核准後，準備公司設立登記送件。",
            cityOutputs,
            () =>
              void batchDownload(
                cityOutputs,
                `${form.company}_市政府設立文件.zip`,
              ),
            "下載市政府全部文件",
          )}
          {renderOutputs(
            "國稅局設籍",
            "市政府核准並取得蓋章登記事項卡後，再準備國稅局送件。",
            taxOutputs,
            () =>
              void batchDownload(taxOutputs, `${form.company}_國稅局文件.zip`),
            "下載國稅局全部文件",
          )}
          <footer className="stage-actions">
            <button className="secondary" onClick={() => setStep(2)}>
              <ArrowLeft size={16} />
              上一步
            </button>
            <button className="primary" onClick={() => setStep(4)}>
              前往核准追蹤
              <ArrowRight size={16} />
            </button>
          </footer>
        </section>
      )}
      {step === 4 && (
        <ApprovalTracking caseId={activeCaseId} onBack={() => setStep(3)} />
      )}
    </main>
  );
}
