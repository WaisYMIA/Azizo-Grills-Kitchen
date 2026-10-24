<?php
/**
 * A minimal, dependency-free .xlsx writer — writes a single-sheet workbook
 * with a header row, using inline strings (no shared-string table needed).
 * Deliberately small so the backend needs no Composer packages.
 *
 * Usage: xlsx_write($headers, $rows, $outputFilePath);
 *   $headers = ['id', 'name', 'price', ...]
 *   $rows    = [['f1', 'Beef Rump', 650, ...], ...]  (same order as $headers)
 */

function xlsx_col_letter(int $index): string {
    // 0-based column index -> spreadsheet column letter (0 -> A, 25 -> Z, 26 -> AA, ...)
    $letter = '';
    $index++;
    while ($index > 0) {
        $rem = ($index - 1) % 26;
        $letter = chr(65 + $rem) . $letter;
        $index = intdiv($index - 1, 26);
    }
    return $letter;
}

function xlsx_escape(string $s): string {
    return htmlspecialchars($s, ENT_QUOTES | ENT_XML1, 'UTF-8');
}

function xlsx_write(array $headers, array $rows, string $outputPath): void {
    $allRows = array_merge([$headers], $rows);
    $sheetXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' .
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' .
        '<sheetData>';

    foreach ($allRows as $rowIndex => $row) {
        $rowNum = $rowIndex + 1;
        $sheetXml .= "<row r=\"$rowNum\">";
        foreach (array_values($row) as $colIndex => $value) {
            $cellRef = xlsx_col_letter($colIndex) . $rowNum;
            if ($value === null) $value = '';
            $isNumber = (is_int($value) || is_float($value)) ||
                (is_string($value) && $value !== '' && preg_match('/^-?\d+(\.\d+)?$/', $value));
            if ($isNumber) {
                $sheetXml .= "<c r=\"$cellRef\"><v>" . xlsx_escape((string)$value) . "</v></c>";
            } else {
                $sheetXml .= "<c r=\"$cellRef\" t=\"inlineStr\"><is><t xml:space=\"preserve\">" . xlsx_escape((string)$value) . "</t></is></c>";
            }
        }
        $sheetXml .= '</row>';
    }
    $sheetXml .= '</sheetData></worksheet>';

    $contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' .
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' .
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' .
        '<Default Extension="xml" ContentType="application/xml"/>' .
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' .
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' .
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' .
        '</Types>';

    $rootRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' .
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' .
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' .
        '</Relationships>';

    $workbook = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' .
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' .
        '<sheets><sheet name="Products" sheetId="1" r:id="rId1"/></sheets>' .
        '</workbook>';

    $workbookRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' .
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' .
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' .
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' .
        '</Relationships>';

    $styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' .
        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' .
        '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>' .
        '<fills count="1"><fill><patternFill patternType="none"/></fill></fills>' .
        '<borders count="1"><border/></borders>' .
        '<cellStyleXfs count="1"><xf/></cellStyleXfs>' .
        '<cellXfs count="1"><xf/></cellXfs>' .
        '</styleSheet>';

    if (file_exists($outputPath)) unlink($outputPath);
    $zip = new ZipArchive();
    $zip->open($outputPath, ZipArchive::CREATE);
    $zip->addEmptyDir('_rels');
    $zip->addEmptyDir('xl');
    $zip->addEmptyDir('xl/worksheets');
    $zip->addEmptyDir('xl/_rels');
    $zip->addFromString('[Content_Types].xml', $contentTypes);
    $zip->addFromString('_rels/.rels', $rootRels);
    $zip->addFromString('xl/workbook.xml', $workbook);
    $zip->addFromString('xl/_rels/workbook.xml.rels', $workbookRels);
    $zip->addFromString('xl/styles.xml', $styles);
    $zip->addFromString('xl/worksheets/sheet1.xml', $sheetXml);
    $zip->close();
}
