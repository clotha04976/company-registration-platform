import unittest

import cv2
import numpy as np
import zxingcpp

from app.identity import (
    OcrToken,
    date_consistency_warnings,
    decode_barcode_national_id,
    detect_card_candidates,
    extract_address,
    extract_birth_date,
    extract_issue_date,
    extract_name,
    extract_national_id,
    is_valid_national_id,
    normalize_roc_date,
)


class IdentityParsingTests(unittest.TestCase):
    def test_validates_and_extracts_taiwan_id(self):
        self.assertTrue(is_valid_national_id("A123456789"))
        self.assertFalse(is_valid_national_id("A123456788"))
        self.assertEqual(extract_national_id(["證號 A 1 2 3 4 5 6 7 8 9"]), "A123456789")

    def test_extracts_roc_birth_date_near_label(self):
        tokens = [
            OcrToken("出生日期", 0.99, (10, 10, 90, 30)),
            OcrToken("民國080年05月06日", 0.98, (100, 10, 260, 30)),
        ]
        self.assertEqual(extract_birth_date(tokens), "080/05/06")
        self.assertEqual(normalize_roc_date("民國115-7-8"), "115/07/08")

    def test_extracts_multiline_back_address(self):
        tokens = [
            OcrToken("住址", 0.99, (10, 10, 50, 30)),
            OcrToken("臺北市中正區測試路", 0.98, (60, 10, 250, 30)),
            OcrToken("一段12號3樓", 0.98, (60, 40, 180, 60)),
        ]
        self.assertEqual(extract_address(tokens), "臺北市中正區測試路一段12號3樓")

    def test_extracts_name_split_across_front_tokens_and_rejects_date_heading(self):
        tokens = [
            OcrToken("姓名陳", 0.99, (112, 545, 481, 671)),
            OcrToken("俞", 0.99, (668, 541, 805, 681)),
            OcrToken("欣", 0.99, (987, 543, 1132, 680)),
            OcrToken("年月日", 0.99, (123, 827, 321, 917)),
        ]
        self.assertEqual(extract_name(tokens), "陳俞欣")

    def test_address_keeps_county_town_village_and_removes_barcode_digits(self):
        tokens = [
            OcrToken("住址", 0.99, (31, 118, 73, 142)),
            OcrToken("南投縣竹山镇延祥里17鄰", 0.98, (70, 114, 240, 136)),
            OcrToken("集山路三段301巷81弄62號", 0.98, (72, 130, 251, 151)),
            OcrToken("0181691323", 0.99, (231, 196, 344, 217)),
        ]
        self.assertEqual(
            extract_address(tokens),
            "南投縣竹山鎮延祥里17鄰集山路三段301巷81弄62號",
        )

    def test_address_first_line_printed_above_the_label(self):
        # The 住址 label box is centred against both wrapped lines, so in
        # reading order the first line precedes the label. Scanning forward
        # only would return "測試路一段133號" without its city and district.
        tokens = [
            OcrToken("臺中市南屯區範例里9鄰", 0.99, (200, 100, 460, 124)),
            OcrToken("住址", 0.99, (30, 128, 72, 152)),
            OcrToken("測試路一段133號", 0.99, (200, 156, 420, 180)),
        ]
        self.assertEqual(
            extract_address(tokens),
            "臺中市南屯區範例里9鄰測試路一段133號",
        )

    def test_address_ignores_birthplace_row_above_it(self):
        tokens = [
            OcrToken("出生地", 0.99, (30, 60, 72, 84)),
            OcrToken("臺灣省南投縣", 0.99, (200, 60, 340, 84)),
            OcrToken("住址南投縣草屯鎮範例里12鄰", 0.99, (30, 100, 420, 124)),
            OcrToken("測試街59號", 0.99, (200, 130, 330, 154)),
        ]
        self.assertEqual(
            extract_address(tokens),
            "南投縣草屯鎮範例里12鄰測試街59號",
        )

    def test_address_ignores_bare_city_birthplace(self):
        # Real geometry from a card whose 出生地 is a bare "臺北市": it carries
        # no 省 and looks exactly like the head of an address, so only row
        # ownership keeps it out. Also covers the two 10-digit card serials
        # printed above and below the fields.
        tokens = [
            OcrToken("0102030405", 0.99, (1279, 1, 1369, 32)),
            OcrToken("父", 0.99, (37, 38, 104, 105)),
            OcrToken("母", 0.99, (668, 38, 741, 111)),
            OcrToken("王大明", 0.99, (297, 55, 583, 150)),
            OcrToken("陳美玉", 0.99, (948, 55, 1235, 152)),
            OcrToken("役別", 0.99, (682, 169, 827, 241)),
            OcrToken("出生地", 0.99, (46, 295, 193, 368)),
            OcrToken("臺北市", 0.99, (212, 324, 479, 413)),
            OcrToken("住址", 0.99, (86, 451, 151, 516)),
            OcrToken("新北市汐止區範例里4鄰", 0.99, (259, 445, 844, 520)),
            OcrToken("測試路二段66巷111弄35號", 0.99, (259, 515, 935, 582)),
            OcrToken("0506070809", 0.99, (1043, 762, 1258, 836)),
        ]
        self.assertEqual(
            extract_address(tokens),
            "新北市汐止區範例里4鄰測試路二段66巷111弄35號",
        )

    def test_address_orders_rows_of_differing_glyph_heights(self):
        # Measured from a real card: the rows are 43px apart but their glyph
        # heights differ (39 vs 41), so bucketing by each token's own height
        # collapsed them into one row and the x tie-break emitted the second
        # line first. Row order must not depend on glyph height.
        tokens = [
            OcrToken("住址", 0.99, (96, 943, 149, 995)),
            OcrToken("測試路9號二十四樓之9", 0.99, (280, 968, 502, 1009)),
            OcrToken("臺中市梧棲區範例里9鄰", 0.99, (306, 926, 522, 965)),
        ]
        self.assertEqual(
            extract_address(tokens),
            "臺中市梧棲區範例里9鄰測試路9號二十四樓之9",
        )

    def test_address_orders_rows_separated_by_a_single_pixel(self):
        # Measured from a real card: the two lines are adjacent to the pixel
        # (bottom 624, top 625) and the upper line is the wider of the two, so
        # any row bucketing that falls through to an x tie-break inverts them.
        tokens = [
            OcrToken("新北市新店區範例里10鄰", 0.99, (372, 576, 900, 624)),
            OcrToken("住址", 0.99, (232, 611, 336, 663)),
            OcrToken("測試街91號二樓", 0.99, (376, 625, 706, 675)),
        ]
        self.assertEqual(
            extract_address(tokens),
            "新北市新店區範例里10鄰測試街91號二樓",
        )

    def test_address_keeps_text_glued_to_a_foreign_label(self):
        # OCR merges adjacent fields into one token often enough that a whole
        # merged token cannot simply be discarded: "出生地臺灣省臺中縣" and
        # "配偶陳美玉役别替代備役" both occur in the samples. Cutting at the
        # label keeps whatever address text shares the token.
        tokens = [
            OcrToken("住址", 0.99, (30, 100, 72, 124)),
            OcrToken("臺中市大甲區範例里9鄰測試路五段468號統一編號", 0.99, (200, 100, 700, 124)),
        ]
        self.assertEqual(
            extract_address(tokens),
            "臺中市大甲區範例里9鄰測試路五段468號",
        )

    def test_address_folds_full_width_digits(self):
        tokens = [
            OcrToken("住址", 0.99, (30, 100, 72, 124)),
            OcrToken("臺中市東區測試街４０２號", 0.99, (200, 100, 480, 124)),
        ]
        self.assertEqual(extract_address(tokens), "臺中市東區測試街402號")

    def test_birth_date_ignores_issue_date_token(self):
        # 發證日期 carries the same 民國 date shape and sits directly below
        # 出生年月日, so it must not satisfy the birth-date lookup.
        tokens = [
            OcrToken("出生", 0.99, (30, 100, 72, 124)),
            OcrToken("發證日期民國115年1月9日(竹縣)换發", 0.99, (200, 108, 620, 132)),
            OcrToken("年月日民國82年10月12日", 0.99, (200, 140, 520, 164)),
        ]
        self.assertEqual(extract_birth_date(tokens), "082/10/12")
        self.assertEqual(extract_issue_date(tokens), "115/01/09")

    def test_flags_swapped_birth_and_issue_dates(self):
        self.assertEqual(date_consistency_warnings("082/10/12", "115/01/09"), [])
        self.assertEqual(
            date_consistency_warnings("115/01/09", "082/10/12"),
            ["出生年月日與發證日期疑似對調，請人工確認"],
        )
        self.assertTrue(date_consistency_warnings("110/01/01", "115/01/09"))

    def test_decodes_barcode_on_a_low_resolution_back(self):
        # A 412x237 crop is a common scan size and its bars are too thin to
        # detect until the image is enlarged.
        image = np.full((237, 412, 3), 255, np.uint8)
        barcode = zxingcpp.create_barcode("A123456789", zxingcpp.BarcodeFormat.Code128)
        rendered = cv2.cvtColor(
            np.array(zxingcpp.write_barcode_to_image(barcode)), cv2.COLOR_GRAY2BGR
        )
        rendered = cv2.resize(rendered, (200, 40), interpolation=cv2.INTER_NEAREST)
        image[170:210, 20:220] = rendered
        national_id, barcode_format = decode_barcode_national_id(image)
        self.assertEqual(national_id, "A123456789")
        self.assertIn("128", barcode_format)

    def test_detects_two_card_shaped_regions_on_a4(self):
        image = np.full((1400, 1000, 3), 255, np.uint8)
        cv2.rectangle(image, (120, 160), (880, 640), (0, 0, 0), 8)
        cv2.rectangle(image, (120, 760), (880, 1240), (0, 0, 0), 8)
        self.assertEqual(len(detect_card_candidates(image)), 2)

    def test_detects_two_pale_borderless_cards_on_a4(self):
        image = np.full((1400, 1000, 3), 255, np.uint8)
        cv2.rectangle(image, (620, 120), (900, 600), (225, 235, 242), -1)
        cv2.rectangle(image, (650, 780), (930, 1260), (235, 228, 220), -1)
        cv2.putText(image, "ID CARD", (680, 300), cv2.FONT_HERSHEY_SIMPLEX, 1, (80, 80, 80), 3)
        cv2.putText(image, "ADDRESS", (690, 980), cv2.FONT_HERSHEY_SIMPLEX, 1, (80, 80, 80), 3)
        self.assertEqual(len(detect_card_candidates(image)), 2)


if __name__ == "__main__":
    unittest.main()
