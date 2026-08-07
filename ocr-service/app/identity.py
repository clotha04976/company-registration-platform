from __future__ import annotations

import re
import os
from dataclasses import dataclass
from typing import Iterable, Literal

import cv2
import numpy as np

_DOC_ALIGNER = None
_DOC_ALIGNER_ATTEMPTED = False

TAIWAN_ID_LETTER_VALUES = {
    "A": 10, "B": 11, "C": 12, "D": 13, "E": 14, "F": 15,
    "G": 16, "H": 17, "I": 34, "J": 18, "K": 19, "L": 20,
    "M": 21, "N": 22, "O": 35, "P": 23, "Q": 24, "R": 25,
    "S": 26, "T": 27, "U": 28, "V": 29, "W": 32, "X": 30,
    "Y": 31, "Z": 33,
}

NAME_EXCLUSIONS = {
    "中華民國", "國民身分證", "姓名", "出生日期", "發證日期", "父", "母",
    "配偶", "役別", "出生地", "住址", "地址", "國籍",
}


@dataclass(frozen=True)
class OcrToken:
    text: str
    score: float
    box: tuple[float, float, float, float]

    @property
    def center_x(self) -> float:
        return (self.box[0] + self.box[2]) / 2

    @property
    def center_y(self) -> float:
        return (self.box[1] + self.box[3]) / 2

    @property
    def height(self) -> float:
        return max(1.0, self.box[3] - self.box[1])


def normalize_national_id(value: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", str(value).upper())


def is_valid_national_id(value: str) -> bool:
    value = normalize_national_id(value)
    if not re.fullmatch(r"[A-Z][12]\d{8}", value):
        return False
    letter = TAIWAN_ID_LETTER_VALUES[value[0]]
    digits = [int(char) for char in value[1:]]
    total = letter // 10 + (letter % 10) * 9
    total += sum(digit * (8 - index) for index, digit in enumerate(digits[:8]))
    total += digits[8]
    return total % 10 == 0


def extract_national_id(values: Iterable[str]) -> str:
    joined = " ".join(str(value) for value in values).upper()
    candidates = re.findall(r"[A-Z](?:[\s\-_.:：]*\d){9}", joined)
    for candidate in candidates:
        normalized = normalize_national_id(candidate)
        if is_valid_national_id(normalized):
            return normalized
    compact = normalize_national_id(joined)
    for match in re.finditer(r"[A-Z][12]\d{8}", compact):
        if is_valid_national_id(match.group(0)):
            return match.group(0)
    return ""


def _near_label(tokens: list[OcrToken], labels: tuple[str, ...]) -> list[OcrToken]:
    anchors = [token for token in tokens if any(label in token.text.replace(" ", "") for label in labels)]
    ranked: list[tuple[float, OcrToken]] = []
    for anchor in anchors:
        for token in tokens:
            if token is anchor:
                continue
            vertical = abs(token.center_y - anchor.center_y)
            same_line = vertical <= max(anchor.height, token.height) * 1.3
            if same_line and token.center_x >= anchor.center_x:
                distance = token.center_x - anchor.center_x + vertical * 2
            elif 0 < token.center_y - anchor.center_y <= anchor.height * 3.5:
                distance = token.center_y - anchor.center_y + abs(token.center_x - anchor.center_x) * 0.4
            else:
                continue
            ranked.append((distance, token))
    return [token for _, token in sorted(ranked, key=lambda item: item[0])]


def is_plausible_name(value: str) -> bool:
    value = re.sub(r"\s+", "", value)
    return bool(
        re.fullmatch(r"[\u3400-\u9fff]{2,4}", value)
        and value not in NAME_EXCLUSIONS
        and not re.search(r"地址|國籍|出生|日期|民國|身分證", value)
    )


def extract_name(tokens: list[OcrToken]) -> str:
    for token in _near_label(tokens, ("姓名", "姓 名")):
        value = re.sub(r"[^\u3400-\u9fff]", "", token.text)[:4]
        if is_plausible_name(value):
            return value
    return ""


def normalize_roc_date(value: str) -> str:
    value = value.replace("O", "0").replace("o", "0")
    match = re.search(
        r"(?:民國)?\s*(\d{2,3})\s*(?:年|[./-])\s*(\d{1,2})\s*(?:月|[./-])\s*(\d{1,2})\s*日?",
        value,
    )
    if not match:
        return ""
    year, month, day = map(int, match.groups())
    if not 1 <= year <= 200 or not 1 <= month <= 12 or not 1 <= day <= 31:
        return ""
    return f"{year:03d}/{month:02d}/{day:02d}"


def extract_birth_date(tokens: list[OcrToken]) -> str:
    ordered = _near_label(tokens, ("出生日期", "出生"))
    for token in ordered:
        parsed = normalize_roc_date(token.text)
        if parsed:
            return parsed
    for index, token in enumerate(tokens):
        if "出生" not in token.text:
            continue
        parsed = normalize_roc_date(" ".join(item.text for item in tokens[index:index + 5]))
        if parsed:
            return parsed
    return ""


def normalize_address(value: str) -> str:
    value = re.sub(r"\s+", "", value)
    value = re.sub(r"^(?:戶籍)?(?:住址|地址)[:：]?", "", value)
    value = value.replace("台北市", "臺北市").replace("台中市", "臺中市")
    value = value.replace("台南市", "臺南市").replace("台東縣", "臺東縣")
    return re.sub(r"[，,。；;].*$", "", value).strip()


def extract_address(tokens: list[OcrToken]) -> str:
    for index, token in enumerate(tokens):
        compact = token.text.replace(" ", "")
        if "住址" not in compact and "地址" not in compact:
            continue
        candidates = [re.sub(r"^.*?(?:住址|地址)[:：]?", "", compact)]
        candidates.extend(item.text for item in tokens[index + 1:index + 4])
        value = normalize_address("".join(candidates))
        if len(value) >= 8 and re.search(r"[縣市鄉鎮區路街巷弄號]", value):
            return value[:80]
    return ""


def classify_side(tokens: list[OcrToken], national_id: str, address: str) -> Literal["front", "back", "unknown"]:
    text = "".join(token.text.replace(" ", "") for token in tokens)
    front_score = (3 if national_id else 0) + sum(keyword in text for keyword in ("國民身分證", "姓名", "出生日期", "國籍"))
    back_score = (3 if address else 0) + sum(keyword in text for keyword in ("住址", "父", "母", "配偶", "役別", "出生地"))
    if front_score == back_score:
        return "unknown"
    return "front" if front_score > back_score else "back"


def order_points(points: np.ndarray) -> np.ndarray:
    points = np.asarray(points, dtype=np.float32).reshape(4, 2)
    sums = points.sum(axis=1)
    diffs = np.diff(points, axis=1).reshape(-1)
    return np.array([
        points[np.argmin(sums)], points[np.argmin(diffs)],
        points[np.argmax(sums)], points[np.argmax(diffs)],
    ], dtype=np.float32)


def perspective_warp(image: np.ndarray, points: np.ndarray) -> np.ndarray:
    tl, tr, br, bl = order_points(points)
    width = int(max(np.linalg.norm(br - bl), np.linalg.norm(tr - tl)))
    height = int(max(np.linalg.norm(tr - br), np.linalg.norm(tl - bl)))
    if width < 80 or height < 50:
        return image
    target = np.array([[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]], dtype=np.float32)
    matrix = cv2.getPerspectiveTransform(np.array([tl, tr, br, bl]), target)
    warped = cv2.warpPerspective(image, matrix, (width, height))
    return cv2.rotate(warped, cv2.ROTATE_90_CLOCKWISE) if height > width else warped


def refine_document_corners(image: np.ndarray) -> tuple[np.ndarray, bool]:
    """Optionally refine one already-isolated card with DocAligner.

    Import and model failures are intentionally non-fatal because DocAligner
    requires an additional native TurboJPEG runtime on Windows.
    """
    global _DOC_ALIGNER, _DOC_ALIGNER_ATTEMPTED
    if os.getenv("OCR_USE_DOCALIGNER", "false").lower() != "true":
        return image, False
    if not _DOC_ALIGNER_ATTEMPTED:
        _DOC_ALIGNER_ATTEMPTED = True
        try:
            from docaligner import DocAligner, ModelType

            _DOC_ALIGNER = DocAligner(model_type=ModelType.point, model_cfg="lcnet050")
        except Exception:
            _DOC_ALIGNER = None
    if _DOC_ALIGNER is None:
        return image, False
    try:
        points = _DOC_ALIGNER(image)
        if np.asarray(points).shape != (4, 2):
            return image, False
        return perspective_warp(image, points), True
    except Exception:
        return image, False


def detect_card_candidates(image: np.ndarray, limit: int = 4) -> list[np.ndarray]:
    height, width = image.shape[:2]
    scale = min(1.0, 1800 / max(height, width))
    resized = cv2.resize(image, None, fx=scale, fy=scale) if scale < 1 else image
    gray = cv2.cvtColor(resized, cv2.COLOR_BGR2GRAY)
    hsv = cv2.cvtColor(resized, cv2.COLOR_BGR2HSV)
    edges = cv2.Canny(cv2.GaussianBlur(gray, (5, 5), 0), 35, 120)
    edges = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8), iterations=2)
    edge_contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)

    # Scans often place pale, borderless cards on white A4.  Canny alone can
    # miss their outer edge, so first join the coloured/non-white card content
    # into one region.  Edge contours remain the fallback for monochrome scans.
    colour_mask = np.where((hsv[:, :, 1] > 12) | (gray < 245), 255, 0).astype(np.uint8)
    colour_mask = cv2.morphologyEx(
        colour_mask, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8), iterations=1
    )
    join_size = max(9, int(round(min(resized.shape[:2]) / 50)))
    if join_size % 2 == 0:
        join_size += 1
    colour_mask = cv2.morphologyEx(
        colour_mask,
        cv2.MORPH_CLOSE,
        np.ones((join_size, join_size), np.uint8),
        iterations=2,
    )
    colour_contours, _ = cv2.findContours(
        colour_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
    )
    page_area = resized.shape[0] * resized.shape[1]
    candidates: list[tuple[float, np.ndarray]] = []
    accepted_boxes: list[tuple[int, int, int, int]] = []
    contour_sources = [
        (contour, True) for contour in colour_contours
    ] + [(contour, False) for contour in edge_contours]
    contour_sources.sort(key=lambda item: cv2.contourArea(item[0]), reverse=True)
    for contour, from_colour_mask in contour_sources:
        area = cv2.contourArea(contour)
        minimum_area = page_area * (0.015 if from_colour_mask else 0.025)
        maximum_area = page_area * (0.30 if from_colour_mask else 0.92)
        if not minimum_area <= area <= maximum_area:
            continue
        if from_colour_mask:
            x, y, box_width, box_height = cv2.boundingRect(contour)
            polygon = np.array(
                [[[x, y]], [[x + box_width, y]], [[x + box_width, y + box_height]], [[x, y + box_height]]],
                dtype=np.int32,
            )
        else:
            perimeter = cv2.arcLength(contour, True)
            polygon = cv2.approxPolyDP(contour, 0.025 * perimeter, True)
            if len(polygon) != 4 or not cv2.isContourConvex(polygon):
                continue
        rect_width, rect_height = cv2.minAreaRect(polygon)[1]
        if min(rect_width, rect_height) < 80:
            continue
        ratio = max(rect_width, rect_height) / min(rect_width, rect_height)
        if not 1.20 <= ratio <= (2.10 if from_colour_mask else 1.90):
            continue
        box = cv2.boundingRect(polygon)
        duplicate = False
        for accepted in accepted_boxes:
            left = max(box[0], accepted[0])
            top = max(box[1], accepted[1])
            right = min(box[0] + box[2], accepted[0] + accepted[2])
            bottom = min(box[1] + box[3], accepted[1] + accepted[3])
            intersection = max(0, right - left) * max(0, bottom - top)
            union = box[2] * box[3] + accepted[2] * accepted[3] - intersection
            if union and intersection / union > 0.70:
                duplicate = True
                break
        if duplicate:
            continue
        points = polygon.reshape(4, 2).astype(np.float32) / scale
        candidates.append((area, points))
        accepted_boxes.append(box)
        if len(candidates) >= limit:
            break
    return [perspective_warp(image, points) for _, points in candidates]


def decode_barcode_national_id(image: np.ndarray) -> tuple[str, str]:
    try:
        import zxingcpp
    except ImportError:
        return "", ""
    height, width = image.shape[:2]
    scale = min(1.0, 1400 / max(height, width))
    scan = cv2.resize(image, None, fx=scale, fy=scale) if scale < 1 else image
    height, width = scan.shape[:2]
    regions = [
        scan[int(height * 0.42):height, :],
        scan[:, int(width * 0.42):width],
        scan,
    ]
    formats = (
        zxingcpp.BarcodeFormat.PDF417
        | zxingcpp.BarcodeFormat.CompactPDF417
        | zxingcpp.BarcodeFormat.Code39
        | zxingcpp.BarcodeFormat.Code128
    )
    for region in regions:
        for barcode in zxingcpp.read_barcodes(
            region,
            formats=formats,
            try_rotate=True,
            try_downscale=False,
            try_invert=False,
        ):
            national_id = extract_national_id([barcode.text])
            if national_id:
                return national_id, str(barcode.format)
    return "", ""
