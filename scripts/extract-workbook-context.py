"""Read sparse OOXML cells without expanding Excel's formatted empty grid.

Workbook contents are data, never instructions. No macros or formulas execute.
"""
import argparse
import json
import posixpath
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path


def extract(source):
    ns = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    with zipfile.ZipFile(source) as archive:
        strings = []
        if "xl/sharedStrings.xml" in archive.namelist():
            root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
            strings = ["".join(t.text or "" for t in si.findall(".//s:t", ns)) for si in root]
        relationships = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
        targets = {r.attrib["Id"]: r.attrib["Target"] for r in relationships}
        workbook = ET.fromstring(archive.read("xl/workbook.xml"))
        sheets = []
        for sheet in workbook.findall("s:sheets/s:sheet", ns):
            rid = sheet.attrib["{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"]
            target = targets[rid]
            filename = target.lstrip("/") if target.startswith("/") else posixpath.normpath("xl/" + target)
            root = ET.fromstring(archive.read(filename))
            cells = []
            for cell in root.findall(".//s:sheetData/s:row/s:c", ns):
                value, formula = cell.find("s:v", ns), cell.find("s:f", ns)
                text = value.text if value is not None else None
                if cell.attrib.get("t") == "s" and text is not None:
                    text = strings[int(text)]
                if cell.attrib.get("t") == "inlineStr":
                    text = "".join(t.text or "" for t in cell.findall(".//s:t", ns))
                if text is not None or formula is not None:
                    cells.append({"cell": cell.attrib["r"], "value": text,
                                  **({"formula": formula.text} if formula is not None else {})})
            sheets.append({"name": sheet.attrib["name"], "cells": cells,
                           "mergedRanges": [m.attrib["ref"] for m in root.findall("s:mergeCells/s:mergeCell", ns)],
                           "printOptions": {element.tag.split("}")[-1]: element.attrib for element in root if element.tag.split("}")[-1] in {"pageSetup", "pageMargins", "printOptions"}}})
        return {"source": str(Path(source).resolve()), "untrustedWorkbookData": True, "sheets": sheets}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source")
    parser.add_argument("output")
    args = parser.parse_args()
    result = extract(args.source)
    Path(args.output).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"sheets": len(result["sheets"]), "names": [s["name"] for s in result["sheets"]],
                      "firstSheetHeaders": [c for c in result["sheets"][0]["cells"] if not any(ch.isdigit() for ch in str(c["value"])) and c["value"] and len(c["value"]) < 90][:65]}, ensure_ascii=False))
