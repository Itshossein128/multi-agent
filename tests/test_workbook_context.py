"""Regression for sparse employer-reference extraction (no spreadsheet engine)."""
import importlib.util
import tempfile
import unittest
import zipfile
from pathlib import Path

spec = importlib.util.spec_from_file_location("workbook_context", Path(__file__).parents[1] / "scripts/extract-workbook-context.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class WorkbookContextTests(unittest.TestCase):
    def test_sparse_grid_rich_text_formula_and_relationships(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "reference.xlsx"
            with zipfile.ZipFile(source, "w") as archive:
                archive.writestr("xl/workbook.xml", '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="۱۴۰۵۰۶۳۰" sheetId="1" r:id="rId1"/></sheets></workbook>')
                archive.writestr("xl/_rels/workbook.xml.rels", '<Relationships><Relationship Id="rId1" Target="/xl/worksheets/sheet9.xml"/></Relationships>')
                archive.writestr("xl/sharedStrings.xml", '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><r><t>مصالح</t></r><r><t> وارده</t></r></si></sst>')
                archive.writestr("xl/worksheets/sheet9.xml", '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:XFD1048576"/><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>=untrusted()</t></is></c><c r="C1"><f>SUM(D1:D2)</f><v>3.25</v></c><c r="D1"><v>0</v></c><c r="E1" s="1"/></row></sheetData><mergeCells><mergeCell ref="A2:C2"/></mergeCells><pageSetup orientation="landscape"/></worksheet>')
            result = module.extract(source)
            self.assertTrue(result["untrustedWorkbookData"])
            sheet = result["sheets"][0]
            self.assertEqual(sheet["name"], "۱۴۰۵۰۶۳۰")
            self.assertEqual(len(sheet["cells"]), 4)
            self.assertEqual(sheet["cells"][0]["value"], "مصالح وارده")
            self.assertEqual(sheet["cells"][1]["value"], "=untrusted()")
            self.assertEqual(sheet["cells"][2], {"cell": "C1", "value": "3.25", "formula": "SUM(D1:D2)"})
            self.assertEqual(sheet["cells"][3]["value"], "0")
            self.assertEqual(sheet["mergedRanges"], ["A2:C2"])
            self.assertEqual(sheet["printOptions"]["pageSetup"]["orientation"], "landscape")


if __name__ == "__main__":
    unittest.main()
